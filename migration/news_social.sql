-- Dimension « réseau social » du module actualités : réactions, commentaires, suivi des lectures.
BEGIN;

CREATE TABLE IF NOT EXISTS gestint.news_reactions (
  news_id       integer NOT NULL REFERENCES gestint.news(id) ON DELETE CASCADE,
  cd_salarie    varchar NOT NULL REFERENCES admin.salaries(cd_salarie) ON DELETE CASCADE,
  emoji         varchar(16) NOT NULL CHECK (emoji IN ('👍','❤️','🌿','👏','😮')),
  date_creation timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (news_id, cd_salarie)            -- une seule réaction par personne et par news
);

CREATE TABLE IF NOT EXISTS gestint.news_comments (
  id            serial PRIMARY KEY,
  news_id       integer NOT NULL REFERENCES gestint.news(id) ON DELETE CASCADE,
  cd_salarie    varchar NOT NULL REFERENCES admin.salaries(cd_salarie) ON DELETE CASCADE,
  contenu       text NOT NULL CHECK (char_length(btrim(contenu)) BETWEEN 1 AND 1000),
  date_creation timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS news_comments_news_id_date_idx ON gestint.news_comments (news_id, date_creation);

CREATE TABLE IF NOT EXISTS gestint.news_vues (
  news_id    integer NOT NULL REFERENCES gestint.news(id) ON DELETE CASCADE,
  cd_salarie varchar NOT NULL REFERENCES admin.salaries(cd_salarie) ON DELETE CASCADE,
  date_vue   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (news_id, cd_salarie)
);

-- Les news existantes sont marquées lues pour tout le monde au lancement
INSERT INTO gestint.news_vues (news_id, cd_salarie)
SELECT n.id, s.cd_salarie FROM gestint.news n CROSS JOIN admin.salaries s
ON CONFLICT DO NOTHING;

COMMIT;
