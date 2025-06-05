const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, AlignmentType, WidthType, ShadingType } = require("docx");
const fs = require("fs");

// Couleurs
const bleuFonce = "1a397b";
const bleuClair = "b6d0f7";
const bleuTable = "eaf1fa";
const orange = "ff6600";
const grisTablePair = "f5faff";
const grisTableHover = "e0eaff";

// Données d'exemple (à remplacer par tes vraies données)
const titrePrincipal = "ENTRETENIR – PELOUSE DU \"MONT\" À LATRECEY @ NICO";
const site = "Pelouse du \"Mont\" à Latrecey @ Nico";
const code = "52003";
const communes = ["Latrecey-Ormoy-sur-Aube"];
const departement = "Haute-Marne";
const objectif_ope = "Entretenir";
const niveau_enjeux = "Espèces";
const enjeux_eco = "Présence de moly";
const pression_maitrise = "Trop de Rubus idaeus environnent";
const operations = [
    {
        type: "Pâturage et opérations associées / Pâturage",
        nom_mo: "Jean-Claude Duss",
        quantite: "5.0",
        unite_str: "hectare",
        financeurs: ["ENS"]
    },
    {
        type: "Traitement de la végétation / Fauche",
        nom_mo: "Jean-Claude Van Damm",
        quantite: "20.0",
        unite_str: "hectare",
        financeurs: ["Conv.cadre - Milieux thermophiles", "LIFE"]
    }
];

// Création du document
const doc = new Document({
    sections: [{
        properties: {},
        children: [
            // Titre principal
            new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                    new TextRun({
                        text: titrePrincipal,
                        bold: true,
                        color: orange,
                        size: 48, // 24pt
                        font: "Arial",
                    }),
                ],
                spacing: { after: 200 }
            }),

            // Section LOCALISATION DU SITE
            new Paragraph({
                text: "LOCALISATION DU SITE",
                shading: { type: ShadingType.CLEAR, color: "auto", fill: bleuFonce },
                color: "FFFFFF",
                bold: true,
                spacing: { after: 80 },
                style: "sectionTitle"
            }),
            new Paragraph({
                children: [
                    new TextRun({ text: "Site / Code site CENCA : ", bold: true }),
                    new TextRun({ text: `${site} / ${code}` }),
                ],
            }),
            new Paragraph({
                children: [
                    new TextRun({ text: "Commune / Département : ", bold: true }),
                    new TextRun({ text: `${communes.join(", ")} / ${departement}` }),
                ],
                spacing: { after: 200 }
            }),

            // Section OBJECTIFS OPÉRATIONNELS
            new Paragraph({
                text: "OBJECTIFS OPÉRATIONNELS",
                shading: { type: ShadingType.CLEAR, color: "auto", fill: bleuFonce },
                color: "FFFFFF",
                bold: true,
                spacing: { after: 80 },
                style: "sectionTitle"
            }),
            new Paragraph({
                children: [
                    new TextRun({ text: "Objectif opérationnel : ", bold: true }),
                    new TextRun({ text: objectif_ope }),
                ],
            }),
            new Paragraph({
                children: [
                    new TextRun({ text: "Niveau d'enjeux : ", bold: true }),
                    new TextRun({ text: niveau_enjeux }),
                ],
            }),
            new Paragraph({
                children: [
                    new TextRun({ text: "Enjeux écologiques : ", bold: true }),
                    new TextRun({ text: enjeux_eco }),
                ],
            }),
            new Paragraph({
                children: [
                    new TextRun({ text: "Pressions à maîtriser : ", bold: true }),
                    new TextRun({ text: pression_maitrise }),
                ],
                spacing: { after: 200 }
            }),

            // Section OPERATIONS
            new Paragraph({
                text: "OPERATIONS",
                shading: { type: ShadingType.CLEAR, color: "auto", fill: bleuFonce },
                color: "FFFFFF",
                bold: true,
                spacing: { after: 80 },
                style: "sectionTitle"
            }),

            // Tableau des opérations
            new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                rows: [
                    // En-tête
                    new TableRow({
                        children: [
                            new TableCell({
                                shading: { type: ShadingType.CLEAR, color: "auto", fill: bleuClair },
                                children: [new Paragraph({ text: "Type d'opération 1 / Type d'opération 2", bold: true, color: bleuFonce })]
                            }),
                            new TableCell({
                                shading: { type: ShadingType.CLEAR, color: "auto", fill: bleuClair },
                                children: [new Paragraph({ text: "Nom du maître d'œuvre", bold: true, color: bleuFonce })]
                            }),
                            new TableCell({
                                shading: { type: ShadingType.CLEAR, color: "auto", fill: bleuClair },
                                children: [new Paragraph({ text: "Quantité - Unité", bold: true, color: bleuFonce })]
                            }),
                            new TableCell({
                                shading: { type: ShadingType.CLEAR, color: "auto", fill: bleuClair },
                                children: [new Paragraph({ text: "Type Programme Finance", bold: true, color: bleuFonce })]
                            }),
                        ]
                    }),
                    // Lignes d'opérations
                    ...operations.map((op, idx) =>
                        new TableRow({
                            children: [
                                new TableCell({ children: [new Paragraph(op.type)] }),
                                new TableCell({ children: [new Paragraph(op.nom_mo)] }),
                                new TableCell({ children: [new Paragraph(`${op.quantite} - ${op.unite_str}`)] }),
                                new TableCell({ children: [new Paragraph(op.financeurs.join(" / "))] }),
                            ],
                            shading: idx % 2 === 1 ? { type: ShadingType.CLEAR, color: "auto", fill: grisTablePair } : undefined
                        })
                    )
                ]
            }),
        ],
    }],
});

// Génération du fichier Word
Packer.toBuffer(doc).then((buffer) => {
    fs.writeFileSync("fiche_bilan.docx", buffer);
    console.log("Document Word généré !");
});