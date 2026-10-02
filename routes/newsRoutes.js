const express = require("express");
const router = express.Router();

const pool = require("../dbPool/poolConnect.js");
const { authenticateToken } = require("../fonctions/fonctionsAuth.js");

const EMOJIS_AUTORISES = ['👍', '❤️', '🌿', '👏', '😮'];
const GROUPE_ADMIN = 5;

// Toutes les routes news sont réservées aux utilisateurs connectés :
// l'utilisateur est TOUJOURS identifié par le JWT, jamais par un paramètre client.
router.use(authenticateToken);

// Le JWT ne contient que l'identifiant : on en déduit le cd_salarie et le statut admin
router.use(async (req, res, next) => {
    try {
        const { rows } = await pool.query(
            `SELECT sal.cd_salarie,
                    EXISTS (SELECT 1 FROM admin.salarie_groupes sg
                            WHERE sg.cd_salarie = sal.cd_salarie AND sg.gro_id = $2) AS is_admin
             FROM admin.salaries sal
             WHERE sal.identifiant = $1;`,
            [req.tokenInfos?.identifiant, GROUPE_ADMIN]
        );
        if (rows.length === 0) return erreur(res, 401, "Utilisateur inconnu.");
        req.salarie = rows[0];
        next();
    } catch (error) {
        console.error("Erreur lors de l'identification du salarié (news) : ", error);
        erreur(res, 500, "Erreur interne du serveur.");
    }
});

function erreur(res, status, message) {
    return res.status(status).json({ success: false, message, code: 1, data: [] });
}

// Sous-requêtes des champs « sociaux » d'une news `n`, pour le salarié passé en paramètre $<p>
function champsSociaux(p) {
    return `COALESCE((SELECT json_agg(json_build_object('emoji', r.emoji, 'count', r.nb, 'mine', r.mine) ORDER BY r.nb DESC, r.emoji)
                      FROM (SELECT emoji, count(*)::int AS nb, bool_or(cd_salarie = $${p}) AS mine
                            FROM gestint.news_reactions WHERE news_id = n.id GROUP BY emoji) r), '[]'::json) AS reactions,
            (SELECT count(*)::int FROM gestint.news_comments c WHERE c.news_id = n.id) AS nb_commentaires,
            EXISTS (SELECT 1 FROM gestint.news_vues v WHERE v.news_id = n.id AND v.cd_salarie = $${p}) AS lu`;
}

const SELECT_COMMENTAIRE = `
    SELECT c.id, c.news_id, c.cd_salarie, s.nom, s.prenom,
           upper(left(coalesce(s.prenom, ''), 1) || left(coalesce(s.nom, ''), 1)) AS initiales,
           c.contenu, c.date_creation
    FROM gestint.news_comments c
    JOIN admin.salaries s ON s.cd_salarie = c.cd_salarie`;

async function newsPubliee(db, id) {
    const { rowCount } = await db.query(
        "SELECT 1 FROM gestint.news WHERE id = $1 AND publie = true;", [id]
    );
    return rowCount > 0;
}

async function reactionsDe(db, newsId, cdSalarie) {
    const { rows } = await db.query(
        `SELECT ${champsSociaux(2)} FROM gestint.news n WHERE n.id = $1;`, [newsId, cdSalarie]
    );
    return rows[0].reactions;
}

// Enveloppe les handlers async pour renvoyer une 500 en cas d'exception
const asyncRoute = (message, handler) => async (req, res) => {
    try {
        await handler(req, res);
    } catch (error) {
        console.error(`Erreur ${message} : `, error);
        if (!res.headersSent) erreur(res, 500, "Erreur interne du serveur.");
    }
};

// Liste paginée des news publiées, avec réactions, nombre de commentaires et statut de lecture
router.get("/", asyncRoute("news/lite", async (req, res) => {
    const limite = parseInt(req.query.limite, 10);
    const offset = parseInt(req.query.offset, 10);

    const { rows } = await pool.query(
        `SELECT n.id, n.titre, n.resume, n.date_publication, n.lien, n.image_url,
                ${champsSociaux(1)}
         FROM gestint.news n
         WHERE n.publie
         ORDER BY n.date_publication DESC, n.id DESC
         LIMIT $2 OFFSET $3;`,
        [
            req.salarie.cd_salarie,
            Number.isInteger(limite) && limite > 0 ? limite : null, // LIMIT NULL = pas de limite
            Number.isInteger(offset) && offset > 0 ? offset : 0
        ]
    );
    res.status(200).json(rows);
}));

// Détail complet d'une news publiée
router.get("/:id(\\d+)", asyncRoute("news/full", async (req, res) => {
    const { rows } = await pool.query(
        `SELECT n.id, n.titre, n.resume, n.contenu, n.date_publication, n.lien, n.image_url,
                ${champsSociaux(2)}
         FROM gestint.news n
         WHERE n.id = $1 AND n.publie = true;`,
        [req.params.id, req.salarie.cd_salarie]
    );
    if (rows.length === 0) return erreur(res, 404, "News introuvable.");
    res.status(200).json(rows[0]);
}));

// Toggle de la réaction de l'utilisateur : même emoji → retrait, sinon pose ou remplacement
router.post("/:id(\\d+)/reactions", asyncRoute("news/reactions", async (req, res) => {
    const { emoji } = req.body ?? {};
    if (!EMOJIS_AUTORISES.includes(emoji)) return erreur(res, 400, "Emoji non autorisé.");

    const newsId = req.params.id;
    const cdSalarie = req.salarie.cd_salarie;
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        if (!(await newsPubliee(client, newsId))) {
            await client.query("ROLLBACK");
            return erreur(res, 404, "News introuvable.");
        }

        const suppression = await client.query(
            "DELETE FROM gestint.news_reactions WHERE news_id = $1 AND cd_salarie = $2 AND emoji = $3;",
            [newsId, cdSalarie, emoji]
        );
        if (suppression.rowCount === 0) {
            await client.query(
                `INSERT INTO gestint.news_reactions (news_id, cd_salarie, emoji) VALUES ($1, $2, $3)
                 ON CONFLICT (news_id, cd_salarie) DO UPDATE SET emoji = EXCLUDED.emoji, date_creation = now();`,
                [newsId, cdSalarie, emoji]
            );
        }

        const reactions = await reactionsDe(client, newsId, cdSalarie);
        await client.query("COMMIT");
        res.status(200).json(reactions);
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}));

// Commentaires d'une news, du plus ancien au plus récent
router.get("/:id(\\d+)/comments", asyncRoute("news/comments", async (req, res) => {
    if (!(await newsPubliee(pool, req.params.id))) return erreur(res, 404, "News introuvable.");
    const { rows } = await pool.query(
        `${SELECT_COMMENTAIRE} WHERE c.news_id = $1 ORDER BY c.date_creation, c.id;`,
        [req.params.id]
    );
    res.status(200).json(rows);
}));

// Ajouter un commentaire (auteur = utilisateur du JWT)
router.post("/:id(\\d+)/comments", asyncRoute("news/comments/create", async (req, res) => {
    const contenu = typeof req.body?.contenu === "string" ? req.body.contenu.trim() : "";
    if (contenu.length < 1 || contenu.length > 1000) {
        return erreur(res, 400, "Le commentaire doit contenir entre 1 et 1000 caractères.");
    }
    if (!(await newsPubliee(pool, req.params.id))) return erreur(res, 404, "News introuvable.");

    const { rows } = await pool.query(
        `WITH c AS (
             INSERT INTO gestint.news_comments (news_id, cd_salarie, contenu)
             VALUES ($1, $2, $3) RETURNING *
         )
         ${SELECT_COMMENTAIRE.replace("FROM gestint.news_comments c", "FROM c")};`,
        [req.params.id, req.salarie.cd_salarie, contenu]
    );
    res.status(201).json(rows[0]);
}));

// Supprimer un commentaire : réservé à son auteur ou à un administrateur
router.delete("/comments/:commentId(\\d+)", asyncRoute("news/comments/delete", async (req, res) => {
    const { rows } = await pool.query(
        `SELECT c.cd_salarie
         FROM gestint.news_comments c
         JOIN gestint.news n ON n.id = c.news_id AND n.publie = true
         WHERE c.id = $1;`,
        [req.params.commentId]
    );
    if (rows.length === 0) return erreur(res, 404, "Commentaire introuvable.");
    if (rows[0].cd_salarie !== req.salarie.cd_salarie && !req.salarie.is_admin) {
        return erreur(res, 403, "Vous ne pouvez supprimer que vos propres commentaires.");
    }

    await pool.query("DELETE FROM gestint.news_comments WHERE id = $1;", [req.params.commentId]);
    res.sendStatus(204);
}));

// Marquer une news comme lue par l'utilisateur
router.post("/:id(\\d+)/vue", asyncRoute("news/vue", async (req, res) => {
    if (!(await newsPubliee(pool, req.params.id))) return erreur(res, 404, "News introuvable.");
    await pool.query(
        `INSERT INTO gestint.news_vues (news_id, cd_salarie) VALUES ($1, $2) ON CONFLICT DO NOTHING;`,
        [req.params.id, req.salarie.cd_salarie]
    );
    res.sendStatus(204);
}));

module.exports = router;
