const { Document, Header, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun, HeadingLevel, AlignmentType, WidthType, ShadingType } = require("docx");
const fs = require("fs");
const path = require('path');

// Couleurs
const bleuFonce = "1a397b";
const bleuClair = "b6d0f7";
const bleuTable = "eaf1fa";
const orange = "ff6600";
const grisTablePair = "f5faff";
const grisTableHover = "e0eaff";

// Création du document
function generateFicheTravauxWord(bilan) {
    // console.log("Génération de la fichev avec ce bilan :", bilan);

    // Charger le logo (adapter le chemin si besoin)
    // const logoBuffer = fs.readFileSync(path.join(__dirname, "logo.png"));

    // const header = new Paragraph({
    //     children: [
    //         new ImageRun({
    //             data: logoBuffer,
    //             transformation: {
    //                 width: 250,
    //                 height: 72,
    //             },
    //         })
    //     ],
    // });

    // const header = new Paragraph({
    //     children: [new TextRun("Ceci est un header test")]
    // });
    
    const doc = new Document({
        sections: [{
            properties: {
                headers: {
                    default: new Header({
                        children: [new Paragraph({
							text: 'footer on 1 page in the section'
						})]
                    }),
                },
            },
            // Marges du document
            margins: {
                top: 1000, // 1cm
                bottom: 1000, // 1cm
                left: 1000, // 1cm
                right: 1000, // 1cm
            },
            // Style du document
            styles: {
                default: {
                    run: {
                        size: 22, // 11pt
                        font: "Arial",
                        color: "000000",
                    },
                    paragraph: {
                        spacing: {
                            after: 200, // 0.2cm
                        },
                        alignment: AlignmentType.LEFT,
                    },
                    heading1: {
                        run: {
                            size: 28, // 14pt
                            bold: true,
                            color: bleuFonce,
                            font: "Arial",
                        },
                        
                    },
                },
                sectionTitle: {
                    run: {
                        size: 22, // 11pt
                        bold: true,
                        color: "FFFFFF",
                        font: "Arial",
                    },
                    paragraph: {
                        spacing: {
                            after: 200, // 0.2cm
                        },
                        alignment: AlignmentType.LEFT,
                        indent: {
                            left: 400, // 2cm
                        },
                        borders: {
                            bottom: {
                                size: 6,
                                color: bleuFonce,
                                space: 0,
                                value: "single",
                            },
                        },
                        shading: {
                            type: ShadingType.CLEAR,
                            color: "auto",
                            fill: bleuFonce,
                        },
                    },
                },
            },
            children: [
                // Titre principal
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                        new TextRun({
                            text: bilan.objectifs[0].obj_ope_str + ' - ' + bilan.site.nom || "FICHE TRAVAUX",
                            bold: true,
                            color: orange,
                            size: 24, // 24pt
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
                        new TextRun({ text: `${bilan.site.nom} / ${bilan.site.code}` }),
                    ],
                }),
                new Paragraph({
                    children: [
                        new TextRun({ text: "Commune / Département : ", bold: true }),
                        new TextRun({ text: `${bilan.communes.map(c => c.nom).join(", ")} / ${bilan.communes.map(c => c.departement).join(", ")}` }),
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
                        new TextRun({ text: bilan.objectifs[0].obj_ope_str }),
                    ],
                }),
                new Paragraph({
                    children: [
                        new TextRun({ text: "Niveau d'enjeux : ", bold: true }),
                        new TextRun({ text: bilan.objectifs[0].nv_enjeux_str }),
                    ],
                }),
                new Paragraph({
                    children: [
                        new TextRun({ text: "Enjeux écologiques : ", bold: true }),
                        new TextRun({ text: bilan.objectifs[0].enjeux_eco }),
                    ],
                }),
                new Paragraph({
                    children: [
                        new TextRun({ text: "Pressions à maîtriser : ", bold: true }),
                        new TextRun({ text: bilan.objectifs[0].pression_maitrise }),
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
                        ...bilan.operations.map((op, idx) =>
                            new TableRow({
                                children: [
                                    new TableCell({ children: [new Paragraph(op.type)] }),
                                    new TableCell({ children: [new Paragraph(op.nom_mo)] }),
                                    new TableCell({ children: [new Paragraph(`${op.quantite} - ${op.unite_str.toLowerCase()}`)] }),
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
    // return Packer.toBuffer(doc); // Retourne une Promise<Buffer>
    
    // // Génération du fichier Word
    Packer.toBuffer(doc).then((buffer) => {
        fs.writeFileSync(path.join(__dirname, "fiche_bilan.docx"), buffer);
        console.log("Document Word généré !");
    });
}


module.exports = {
    generateFicheTravauxWord
};