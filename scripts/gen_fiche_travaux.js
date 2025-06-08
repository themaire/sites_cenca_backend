const { AlignmentType, ImageRun, convertInchesToTwip, Header, Footer, SectionType, PageNumber, WidthType, Table, TableRow, TableCell, ShadingType, Document, HeadingLevel, LevelFormat, Packer, Paragraph, TextRun, UnderlineType } = require("docx");
const fs = require("fs");
const path = require('path');

// Couleurs
const bleuFonce = "1a397b";
const bleuClair = "b6d0f7";
const bleuTable = "eaf1fa";
const orange = "ff6600";
const grisTablePair = "f5faff";
const grisTableHover = "e0eaff";
const grisHeader = "c4c4c4";

// Fonction utilitaire pour créer une cellule de tableau sans bordure
function tableCellNoBorder(options = {}) {
    return new TableCell({
        borders: {
            top: { style: "none", size: 0, color: "FFFFFF" },
            bottom: { style: "none", size: 0, color: "FFFFFF" },
            left: { style: "none", size: 0, color: "FFFFFF" },
            right: { style: "none", size: 0, color: "FFFFFF" },
        },
        ...options
    });
}

// Création du document
function generateFicheTravauxWord(bilan) {
    // console.log("Génération de la fiche avec ce bilan :", bilan);

    const header = new Table({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    rows: [
                        // En-tête
                        new TableRow({
                            children: [
                                tableCellNoBorder({
                                    verticalAlign: "center",
                                    children: [new Paragraph({
                                        children: [
                                            new ImageRun({
                                                data: fs.readFileSync(path.join(__dirname, "logo.png")),
                                                type: "png",
                                                transformation: { width: 250, height: 72 },
                                            })
                                        ]
                                    })]
                                }),
                                tableCellNoBorder({
                                    verticalAlign: "center",
                                    children: [new Paragraph({ text: "" })]
                                }),
                                tableCellNoBorder({
                                    width: { size: 33, type: WidthType.PERCENTAGE },
                                    verticalAlign: "center",
                                    shading: { type: ShadingType.CLEAR, color: "auto", fill: grisHeader },
                                    children: [new Paragraph({
                                        children: [
                                            new TextRun({ text: "FICHE TRAVAUX", bold: true, size: 32 }),
                                            new TextRun({ break: 1 }),
                                            new TextRun({ text: "Responsable : " + bilan.projet.responsable, size: 24 }),
                                            new TextRun({ break: 1 }),
                                            new TextRun({ text: "Année : " + bilan.projet.annee, size: 24 }),
                                        ],
                                        alignment: AlignmentType.RIGHT
                                    })]
                                }),
                            ]
                        })
                    ]
                });
    
    const footer = new Paragraph({
                            alignment: AlignmentType.CENTER,
                            children: [
                                new TextRun({ text: "Conservatoire d'espaces naturels de Champagne-Ardenne"}),
                                new TextRun({ break: 1 }),
                                new TextRun({ text: "9, rue Gustave Eiffel - 10430 Rosières-près-Troyes"}),
                                new TextRun({ break: 1 }),
                                new TextRun({ text: "03 25 80 50 50     |      http://cen-champagne-ardenne.org"}),
                                new TextRun({ break: 1 }),
                                new TextRun({
                                    children: ["Page ", PageNumber.CURRENT, " / ", PageNumber.TOTAL_PAGES],
                                })
                            ],
                        })

    const doc = new Document({
        creator: "CENCA par Nicolas ELIE geomatique@cen-champagne-ardenne.org",
        title: "FICHE TRAVAUX : " + bilan.objectifs[0].obj_ope_str + ' - ' + bilan.site.nom,
        description: "Document généré automatiquement par le CENCA via sont logiciel metier de gestion de sites.",
        // Marges du document
        // margin: {
        //     top: 720, // 1 pouce = 72 points
        //     right: 720,
        //     bottom: 720,
        //     left: 720,
        // },

        // Styles
        styles: {
            default: {
                heading1: { // Titre de niveau 1, rouge, gras et italique
                    run: {
                        size: 28,
                        bold: true,
                        italics: false,
                        color: orange,
                    },
                    paragraph: {
                        spacing: {
                            after: 120,
                        },
                    },
                },
                heading2: { // Titre de niveau 2, double souligné rouge
                    run: {
                        size: 26,
                        bold: true,
                        underline: {
                            type: UnderlineType.DOUBLE,
                            color: "FF0000",
                        },
                    },
                    paragraph: {
                        spacing: {
                            before: 240,
                            after: 120,
                        },
                    },
                },
                heading3: { // Titre de niveau 3, double souligné rouge
                    run: {
                        size: 26,
                        bold: true,
                        underline: {
                            type: UnderlineType.DOUBLE,
                            color: "FF0000",
                        },
                    },
                    paragraph: {
                        spacing: {
                            before: 240,
                            after: 120,
                        },
                    },
                },
                listParagraph: {
                    run: {
                        color: "#FF0000",
                    },
                },
                document: {
                    run: {
                        size: "11pt",
                        font: "Calibri",
                    },
                    paragraph: {
                        alignment: AlignmentType.LEFT,
                    },
                },
            },
            paragraphStyles: [
                {
                    id: "TitrePrime",
                    name: "Titre Principal",
                    basedOn: "Normal",
                    next: "Normal",
                    quickFormat: true,
                    run: {
                        color: "FFFFFF", // Texte blanc
                        bold: true,
                        size: 32, // 32pt
                    },
                    paragraph: {
                        alignment: AlignmentType.CENTER,
                        shading: {
                            type: ShadingType.CLEAR,
                            color: "auto",
                            fill: orange,
                        },
                    },
                },
                {
                    id: "TitreColore",
                    name: "Titre Coloré",
                    basedOn: "Normal",
                    next: "Normal",
                    quickFormat: true,
                    run: {
                        color: "FFFFFF", // Texte blanc
                        bold: true,
                        size: 24, // 24pt
                    },
                    paragraph: {
                        shading: {
                            type: ShadingType.CLEAR,
                            color: "auto",
                            fill: bleuFonce, // Fond bleu (ou remplace par ta couleur)
                        },
                        spacing: {
                            after: 100, // valeur par défaut
                        },
                    },
                },
                {
                    id: "HeaderTable",
                    name: "Entetes de Tableau",
                    basedOn: "Normal",
                    next: "Normal",
                    run: {
                        color: bleuFonce,
                        bold: true,
                        size: 22,
                    },
                },
                {
                    id: "aside",
                    name: "Aside",
                    basedOn: "Normal",
                    next: "Normal",
                    run: {
                        color: "999999",
                        italics: true,
                    },
                    paragraph: {
                        indent: {
                            left: convertInchesToTwip(0.5),
                        },
                        spacing: {
                            line: 276,
                        },
                    },
                },
                {
                    id: "wellSpaced",
                    name: "Well Spaced",
                    basedOn: "Normal",
                    quickFormat: true,
                    paragraph: {
                        spacing: { line: 276, before: 20 * 72 * 0.1, after: 20 * 72 * 0.05 },
                    },
                },
                {
                    id: "strikeUnderline",
                    name: "Strike Underline",
                    basedOn: "Normal",
                    quickFormat: true,
                    run: {
                        strike: true,
                        underline: {
                            type: UnderlineType.SINGLE,
                        },
                    },
                },
            ],
            characterStyles: [
                {
                    id: "strikeUnderlineCharacter",
                    name: "Strike Underline",
                    basedOn: "Normal",
                    quickFormat: true,
                    run: {
                        strike: true,
                        underline: {
                            type: UnderlineType.SINGLE,
                        },
                    },
                },
            ],
        }, // Fin de styles


        sections: [
            {properties: {
                page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } }, // Marges de la section
            },

            headers: {
                    default: new Header({
                        children: [header]
                    }),
            },

            children: [
                
                // Séparateur d'entête
                new Paragraph({
                    spacing: { after: 80 }
                }),

                // Titre principal
                new Paragraph({
                    children: [
                        new TextRun({ text: bilan.objectifs[0].obj_ope_str }),
                        new TextRun({ break: 1 }), // Saut de ligne
                        new TextRun({ text: bilan.site.nom }),
    
                    ],
                    style: "TitrePrime"
                }),
                new Paragraph({ spacing: { after: 200 } }), // Saut de ligne

                // Section LOCALISATION DU SITE
                new Paragraph({
                    text: "LOCALISATION DU SITE",
                    style: "TitreColore"
                }),
                new Paragraph({
                    children: [
                        new TextRun({ text: "Site / Code site CENCA : ", bold: true }),
                        new TextRun({ text: `${bilan.site.nom} / ${bilan.site.code}` }),
                        new TextRun({ break: 1 }), // Saut de ligne
                        new TextRun({ text: "Commune / Département : ", bold: true }),
                        new TextRun({ text: `${bilan.communes.map(c => c.nom).join(", ")} / ${bilan.communes.map(c => c.departement).join(", ")}` }),
                    ],
                    style: "wellSpaced",
                    spacing: { after: 200 }
                }),

                // Section OBJECTIFS OPÉRATIONNELS
                new Paragraph({
                    text: "OBJECTIFS OPÉRATIONNELS",
                    style: "TitreColore"
                }),
                new Paragraph({
                    children: [
                        new TextRun({ text: "Objectif opérationnel : ", bold: true }),
                        new TextRun({ text: bilan.objectifs[0].obj_ope_str }),
                        new TextRun({ break: 1 }),
                        new TextRun({ text: "Niveau d'enjeux : ", bold: true }),
                        new TextRun({ text: bilan.objectifs[0].nv_enjeux_str }),
                        new TextRun({ break: 1 }),
                        new TextRun({ text: "Enjeux écologiques : ", bold: true }),
                        new TextRun({ text: bilan.objectifs[0].enjeux_eco }),
                        new TextRun({ break: 1 }),
                        new TextRun({ text: "Pressions à maîtriser : ", bold: true }),
                        new TextRun({ text: bilan.objectifs[0].pression_maitrise }),
                    ],
                    style: "wellSpaced",
                    spacing: { after: 200 }
                }),

                // Section OPERATIONS
                new Paragraph({
                    text: "OPERATIONS",
                    style: "TitreColore"
                }),

                // Tableau des opérations
                new Table({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    rows: [
                        // En-tête
                        new TableRow({
                            headers: true,
                            children: [
                                new TableCell({
                                    shading: { type: ShadingType.CLEAR, color: "auto", fill: bleuClair },
                                    verticalAlign: "center",
                                    children: [new Paragraph({ 
                                                    children: [
                                                        new TextRun({ text: "Type d'opération 1 /" }),
                                                        new TextRun({ break: 1 }), // Saut de ligne
                                                        new TextRun({ text: "Type d'opération 2"})
                                                    ],
                                                    alignment: AlignmentType.CENTER,
                                                    style: "HeaderTable"
                                        })]
                                }),
                                new TableCell({
                                    shading: { type: ShadingType.CLEAR, color: "auto", fill: bleuClair },
                                    verticalAlign: "center",
                                    children: [new Paragraph({ text: "Maître d'œuvre", style: "HeaderTable" })]
                                }),
                                new TableCell({
                                    shading: { type: ShadingType.CLEAR, color: "auto", fill: bleuClair },
                                    verticalAlign: "center",
                                    children: [new Paragraph({ text: "Quantité - Unité", style: "HeaderTable" })]
                                }),
                                new TableCell({
                                    width: { size: 20, type: WidthType.PERCENTAGE }, // Largeur à 25%
                                    shading: { type: ShadingType.CLEAR, color: "auto", fill: bleuClair },
                                    verticalAlign: "center",
                                    children: [new Paragraph({ text: "Type Programme Finance", style: "HeaderTable" })]
                                }),
                            ]
                        }),
                        // Lignes d'opérations
                        ...bilan.operations.map((op, idx) =>
                            new TableRow({
                                children: [
                                    new TableCell({ children: [new Paragraph(op.type)] }),
                                    new TableCell({ children: [new Paragraph(op.nom_mo)] }),
                                    new TableCell({ children: [new Paragraph(`${op.quantite} - ${op.unite_str.toLowerCase()}${op.quantite > 0 ? "s" : ""}`)] }),
                                    new TableCell({ children: [new Paragraph({
                                        children: op.financeurs.map((financeur, i) => [
                                            new TextRun({ text: financeur, style: "HeaderTable", verticalAlign: "center" }),
                                            i < op.financeurs.length - 1 ? new TextRun({ break: 1 }) : null
                                        ]).flat().filter(Boolean)
                                    })] }),
                                ],
                                shading: idx % 2 === 1 ? { type: ShadingType.CLEAR, color: "auto", fill: grisTablePair } : undefined
                            })
                        )
                    ]
                }),
            ],
            footers: {
                default: new Footer({
                    children: [footer]
                }),
            }}, // Fin de de la première section



            {properties: {
                type: SectionType.NEXT_PAGE,
                page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } }, // Marges de la section
            },
            headers: {
                    default: new Header({
                        children: [header]
                    }),
            },
            children: [

                // Séparateur d'entête
                new Paragraph({
                    spacing: { after: 80 }
                }),

                new Paragraph({
                    text: "DESCRIPTION DES OPERATIONS REALISEES",
                    style: "TitreColore",
                    spacing: { after: 80 }
                }),

                // Boucle des opérations réalisées
                ...bilan.operations.flatMap((op, i) => [
                    new Paragraph({
                        text: `Opération ${i + 1}`,
                        style: "TitreColore",
                        spacing: { after: 80 }
                    }),
                    
                    new Paragraph({
                        children: [
                            new TextRun({ text: "Type d'opération 1 / Type d'opération 2 : ", bold: true }),
                            new TextRun({ text: op.type }),
                            new TextRun({ break: 1 }),
                            new TextRun({ text: "Description (détails) : ", bold: true }),
                            new TextRun({ text: op.description ?? "non spécifiée" }),
                            new TextRun({ break: 1 }),
                            new TextRun({ text: "Remarques particulières : ", bold: true }),
                            new TextRun({ text: op.remarques ?? "non spécifiées" }),
                        ],
                        style: "wellSpaced",
                        spacing: { after: 80 }
                    }),

                    new Table({
                        width: { size: 100, type: WidthType.PERCENTAGE },
                        rows: [
                            new TableRow({
                                headers: true,
                                children: [
                                    new TableCell({
                                        shading: { type: ShadingType.CLEAR, color: "auto", fill: bleuClair },
                                        verticalAlign: "center",
                                        children: [new Paragraph({ text: "Maître d'œuvre", style: "HeaderTable" })]
                                    }),
                                    new TableCell({
                                        shading: { type: ShadingType.CLEAR, color: "auto", fill: bleuClair },
                                        verticalAlign: "center",
                                        children: [new Paragraph({ text: "Cadre de l'intervention", style: "HeaderTable" })]
                                    }),
                                    new TableCell({
                                        shading: { type: ShadingType.CLEAR, color: "auto", fill: bleuClair },
                                        verticalAlign: "center",
                                        children: [new Paragraph({ text: "Quantité - unité", style: "HeaderTable" })]
                                    }),
                                    new TableCell({
                                        shading: { type: ShadingType.CLEAR, color: "auto", fill: bleuClair },
                                        verticalAlign: "center",
                                        children: [new Paragraph({ text: "Date de début", style: "HeaderTable" })]
                                    }),
                                    new TableCell({
                                        shading: { type: ShadingType.CLEAR, color: "auto", fill: bleuClair },
                                        verticalAlign: "center",
                                        children: [new Paragraph({ text: "Date de fin", style: "HeaderTable" })]
                                    }),
                                ]
                            }),
                            new TableRow({
                                children: [
                                    new TableCell({
                                        children: [new Paragraph(op.nom_mo)]
                                    }),
                                    new TableCell({
                                        children: [new Paragraph(bilan.operations_full[op.uuid_ope].cadre_intervention_str)]
                                    }),
                                    new TableCell({
                                        children: [new Paragraph(`${op.quantite} - ${op.unite_str.toLowerCase()}${op.quantite > 0 ? "s" : ""}`)]
                                    }),
                                    new TableCell({
                                        children: [new Paragraph(bilan.operations_full[op.uuid_ope].date_debut_str)]
                                    }),
                                    new TableCell({
                                        children: [new Paragraph(bilan.operations_full[op.uuid_ope].date_fin_str)]
                                    })
                                ]
                            })
                        ]
                    }), // Fin du tableau des détails de l'opération

                    // Ajoutez ici des éléments conditionnels à l'array si besoin, par exemple :
                    ...(bilan.operations_full[op.uuid_ope].action == "028_TRAV_PAT_V2" && bilan.operations_full[op.uuid_ope].action_2 == "210"
                        ? [
                            new Paragraph({
                                children: [
                                    new TextRun({
                                        text: "Données relatives aux travaux de paturages",
                                        bold: true,
                                        break: 1
                                    })
                                ]
                            }),
                            // Tableau des animaux et données de pâturage
                            new Table({
                                width: { size: 100, type: WidthType.PERCENTAGE },
                                rows: [
                                    // En-tête
                                    new TableRow({
                                        headers: true,
                                        children: [
                                            new TableCell({
                                                shading: { type: ShadingType.CLEAR, color: "auto", fill: bleuClair },
                                                verticalAlign: "center",
                                                children: [new Paragraph({ text: "Effectif", style: "HeaderTable" })]
                                            }),
                                            new TableCell({
                                                shading: { type: ShadingType.CLEAR, color: "auto", fill: bleuClair },
                                                verticalAlign: "center",
                                                children: [new Paragraph({ text: "Nb jours", style: "HeaderTable" })]
                                            }),
                                            new TableCell({
                                                shading: { type: ShadingType.CLEAR, color: "auto", fill: bleuClair },
                                                verticalAlign: "center",
                                                children: [new Paragraph({ text: "Chargement (UGB/ha)", style: "HeaderTable" })]
                                            }),
                                            new TableCell({
                                                shading: { type: ShadingType.CLEAR, color: "auto", fill: bleuClair },
                                                verticalAlign: "center",
                                                children: [new Paragraph({ text: "Taux abroutissement", style: "HeaderTable" })]
                                            }),
                                            new TableCell({
                                                shading: { type: ShadingType.CLEAR, color: "auto", fill: bleuClair },
                                                verticalAlign: "center",
                                                children: [new Paragraph({ text: "Animal pâturant", style: "HeaderTable" })]
                                            }),
                                        ]
                                    }),
                                    new TableRow({
                                        verticalAlign: "center",
                                        children: [
                                            new TableCell({ children: [new Paragraph(String(bilan.operations_full[op.uuid_ope].effectif_paturage ?? ""))] }),
                                            new TableCell({ children: [new Paragraph(String(bilan.operations_full[op.uuid_ope].nb_jours_paturage ?? ""))] }),
                                            new TableCell({ children: [new Paragraph(String(bilan.operations_full[op.uuid_ope].chargement_paturage ?? ""))] }),
                                            new TableCell({ children: [new Paragraph(String(bilan.operations_full[op.uuid_ope].abroutissement_paturage ?? ""))] }),
                                            new TableCell({ children: [new Paragraph({
                                                children: op.animaux.map((animal, i) => [
                                                    new TextRun({ text: animal, style: "HeaderTable", verticalAlign: "center" }),
                                                    i < op.animaux.length - 1 ? new TextRun({ break: 1 }) : null
                                                ]).flat().filter(Boolean)
                                            })] }),
                                        ]
                                    })
                                ]
                            }),
                        ]
                        : []
                    ),

                    // Séparateur de fin de boucle
                    new Paragraph({
                        spacing: { after: 180 }
                    }),
                ]),// Fin de la boucle des opérations
            ]}
        ] // Fin de la deuxième section
    });
    // return Packer.toBuffer(doc); // Retourne une Promise<Buffer>

    Packer.toBuffer(doc).then((buffer) => {
        pathDoc = path.join(__dirname, "fiche_bilan.docx");
        // Enregistrer le document Word
        fs.writeFileSync(path.join(__dirname, "fiche_bilan.docx"), buffer);
    });
}

module.exports = {
    generateFicheTravauxWord
};