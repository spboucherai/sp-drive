/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/i18n/preview.ts
 * Module           : i18n
 * Repository       : https://git.spboucher.ai/sp-drive
 * Project Website  : https://drive.spboucher.ai
 * Created          : 2026-11-11
 * Last Modified    : 2026-11-11
 *
 * Author           : Simon-Pierre Boucher
 * Position         : Professor of Finance
 * Institution      : Université du Québec en Outaouais (UQO)
 * Organization     : SP Boucher
 * Website          : https://spboucher.ai
 * Git              : https://git.spboucher.ai
 *
 * Preferred Contact: support@spboucher.ai
 * Development      : dev@spboucher.ai
 * Support          : support@spboucher.ai
 * Security/Admin   : admin@spboucher.ai
 *
 * Copyright (c) 2026
 * Simon-Pierre Boucher
 * All rights reserved where applicable. This file is governed by the
 * applicable project license, copyright notices and relevant law.
 * Existing third-party rights and notices remain unaffected.
 *
 * License          : None specified (no license file in this repository)
 *
 * Do not embed credentials, private keys, access tokens,
 * certificates or confidential personal information.
 *
 * =============================================================================
 * END OF SP BOUCHER SOURCE HEADER
 * =============================================================================
 */

import type { Dict } from '../i18n.ts';

export const preview: Dict = {
  fr: {
    tools: 'Outils d’aperçu', previous: 'Fichier précédent', next: 'Fichier suivant',
    converting: 'Conversion en cours…', convertingHint: 'L’aperçu est préparé sur le serveur. Il s’affichera dès qu’il sera prêt.',
    timeoutTitle: 'L’aperçu tarde à être produit', timeoutText: 'La préparation dure plus de deux minutes. Réessayez dans un moment ou téléchargez le fichier.',
    failedTitle: 'L’aperçu n’a pas pu être produit', failedText: 'Le fichier d’origine est intact : seule sa conversion pour l’affichage a échoué. Motif indiqué par le serveur :',
    convertedNote: 'Rendu converti en PDF pour l’affichage : la mise en page peut différer. Le fichier d’origine n’est pas modifié.',
    noneTitle: 'Aucun aperçu pour ce format', noneType: 'Fichier {ext}', noneTypeUnknown: 'Type inconnu', noDownload: 'Le téléchargement n’est pas autorisé pour ce fichier.',
    crashTitle: 'Cet aperçu ne peut pas être affiché', crashText: 'Le contenu du fichier n’a pas pu être présenté. Le fichier lui-même n’est pas touché.',
    zoomIn: 'Agrandir', zoomOut: 'Réduire', fit: 'Ajuster à l’écran', fitWidth: 'Ajuster à la largeur', fitPage: 'Afficher la page entière',
    imageUnreadable: 'Cette image ne peut pas être affichée', imageUnreadableText: 'Le navigateur ne sait pas lire ce fichier : il est peut-être endommagé ou dans une variante non prise en charge.',
    mediaUnsupported: 'Lecture impossible dans ce navigateur', mediaUnsupportedText: 'Le format ou le codec de ce fichier n’est pas pris en charge ici. Téléchargez-le pour l’ouvrir avec une autre application.',
    page: 'Page', pageOf: 'Page {n} sur {total}', pdfDocument: 'Document de {n} page | Document de {n} pages',
    pdfPasswordTitle: 'PDF protégé par un mot de passe', pdfPasswordText: 'Ce document est chiffré et ne peut pas être affiché ici. Téléchargez-le pour l’ouvrir avec son mot de passe.',
    pdfDamagedTitle: 'Ce PDF ne peut pas être lu', pdfDamagedText: 'Le fichier est endommagé ou n’est pas un PDF valide. Vous pouvez le télécharger pour l’examiner.',
    searchOpen: 'Rechercher dans le document', searchPlaceholder: 'Rechercher dans le document', searchNone: 'Aucun résultat', searchPrev: 'Résultat précédent', searchNext: 'Résultat suivant', searchClose: 'Fermer la recherche',
    wrap: 'Retour à la ligne', source: 'Source', rendered: 'Rendu', table: 'Tableau', tree: 'Arbre', emptyFile: 'Ce fichier est vide.',
    textTruncated: 'Fichier volumineux : seuls les premiers {shown} sur {total} sont affichés. Téléchargez-le pour le voir en entier.',
    mdImageBlocked: 'Image externe non chargée', mdImagesNote: 'Les images hébergées ailleurs ne sont pas chargées : ouvrir un document ne contacte aucun site tiers.',
    csvRowCap: 'Aperçu limité aux {n} premières lignes.', csvColCap: 'Aperçu limité aux {n} premières colonnes sur {total}.',
    csvSummary: '{n} ligne · {cols} colonnes · séparateur : {sep} | {n} lignes · {cols} colonnes · séparateur : {sep}', sepComma: 'virgule', sepSemicolon: 'point-virgule', sepTab: 'tabulation',
    rowNumber: 'Numéro de ligne', emptyCell: '(cellule vide)',
    jsonItems: '{n} élément | {n} éléments', jsonKeys: '{n} clé | {n} clés', jsonMore: 'Afficher la suite ({n} restants)', jsonInvalid: 'Ce fichier n’est pas un JSON valide : il est affiché comme du texte.',
    jsonTruncated: 'Fichier tronqué : le JSON ne peut pas être structuré, il est affiché comme du texte.', expandAll: 'Tout déplier', collapseAll: 'Tout replier',
    sheets: 'Feuilles', sheetEmpty: 'Cette feuille est vide.', sheetNone: 'Ce classeur ne contient aucune feuille lisible.',
    sheetTruncated: 'Aperçu limité à {rows} lignes × {cols} colonnes ; cette feuille en compte {totalRows} × {totalCols}.', sheetsTruncated: 'Seules les {n} premières feuilles sont affichées.',
    archiveNote: 'Inventaire de l’archive : rien n’a été extrait.', archiveTotals: '{format} · {n} entrée · {size} une fois décompressé | {format} · {n} entrées · {size} une fois décompressé',
    archiveSuspicious: 'Attention : cette archive annonce une taille décompressée anormale (possible « bombe de décompression »). Ne l’extrayez pas sans précaution.',
    archiveTruncated: 'Inventaire partiel : {shown} entrées listées sur {n}.', archiveContents: 'Contenu de l’archive', archiveEmpty: 'Cette archive ne contient aucune entrée.', archiveFiles: '{n} fichier | {n} fichiers',
  },
  en: {
    tools: 'Preview tools', previous: 'Previous file', next: 'Next file',
    converting: 'Converting…', convertingHint: 'The preview is being prepared on the server. It will appear as soon as it is ready.',
    timeoutTitle: 'The preview is taking too long', timeoutText: 'Preparation has lasted more than two minutes. Try again in a moment or download the file.',
    failedTitle: 'The preview could not be produced', failedText: 'The original file is intact: only its conversion for display failed. Reason given by the server:',
    convertedNote: 'Rendering converted to PDF for display: the layout may differ. The original file is unchanged.',
    noneTitle: 'No preview for this format', noneType: '{ext} file', noneTypeUnknown: 'Unknown type', noDownload: 'Downloading is not allowed for this file.',
    crashTitle: 'This preview cannot be displayed', crashText: 'The content of the file could not be presented. The file itself is untouched.',
    zoomIn: 'Zoom in', zoomOut: 'Zoom out', fit: 'Fit to screen', fitWidth: 'Fit width', fitPage: 'Fit whole page',
    imageUnreadable: 'This image cannot be displayed', imageUnreadableText: 'The browser cannot read this file: it may be damaged or in an unsupported variant.',
    mediaUnsupported: 'Cannot play in this browser', mediaUnsupportedText: 'The format or codec of this file is not supported here. Download it to open it with another application.',
    page: 'Page', pageOf: 'Page {n} of {total}', pdfDocument: '{n}-page document | {n}-page document',
    pdfPasswordTitle: 'Password-protected PDF', pdfPasswordText: 'This document is encrypted and cannot be displayed here. Download it to open it with its password.',
    pdfDamagedTitle: 'This PDF cannot be read', pdfDamagedText: 'The file is damaged or is not a valid PDF. You can download it to inspect it.',
    searchOpen: 'Search in the document', searchPlaceholder: 'Search in the document', searchNone: 'No results', searchPrev: 'Previous result', searchNext: 'Next result', searchClose: 'Close search',
    wrap: 'Wrap lines', source: 'Source', rendered: 'Rendered', table: 'Table', tree: 'Tree', emptyFile: 'This file is empty.',
    textTruncated: 'Large file: only the first {shown} of {total} are shown. Download it to see everything.',
    mdImageBlocked: 'External image not loaded', mdImagesNote: 'Images hosted elsewhere are not loaded: opening a document contacts no third-party site.',
    csvRowCap: 'Preview limited to the first {n} rows.', csvColCap: 'Preview limited to the first {n} columns of {total}.',
    csvSummary: '{n} row · {cols} columns · separator: {sep} | {n} rows · {cols} columns · separator: {sep}', sepComma: 'comma', sepSemicolon: 'semicolon', sepTab: 'tab',
    rowNumber: 'Row number', emptyCell: '(empty cell)',
    jsonItems: '{n} item | {n} items', jsonKeys: '{n} key | {n} keys', jsonMore: 'Show more ({n} remaining)', jsonInvalid: 'This file is not valid JSON: it is shown as text.',
    jsonTruncated: 'Truncated file: the JSON cannot be structured, it is shown as text.', expandAll: 'Expand all', collapseAll: 'Collapse all',
    sheets: 'Sheets', sheetEmpty: 'This sheet is empty.', sheetNone: 'This workbook has no readable sheet.',
    sheetTruncated: 'Preview limited to {rows} rows × {cols} columns; this sheet has {totalRows} × {totalCols}.', sheetsTruncated: 'Only the first {n} sheets are shown.',
    archiveNote: 'Archive inventory: nothing was extracted.', archiveTotals: '{format} · {n} entry · {size} once extracted | {format} · {n} entries · {size} once extracted',
    archiveSuspicious: 'Warning: this archive declares an abnormal extracted size (possible “decompression bomb”). Do not extract it without care.',
    archiveTruncated: 'Partial inventory: {shown} entries listed out of {n}.', archiveContents: 'Archive contents', archiveEmpty: 'This archive has no entry.', archiveFiles: '{n} file | {n} files',
  },
};
