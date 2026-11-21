/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/i18n/explorer.ts
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

export const explorer: Dict = {
  fr: {
    root: 'Mon Drive', breadcrumbs: 'Fil d’Ariane', crumbsHidden: '{n} dossier parent masqué | {n} dossiers parents masqués',
    'view.recent': 'Récents', 'view.starred': 'Favoris', 'view.trash': 'Corbeille', 'view.search': 'Recherche', 'view.duplicates': 'Doublons',
    new: 'Nouveau', newFolder: 'Nouveau dossier', uploadFiles: 'Téléverser des fichiers', uploadFolder: 'Téléverser un dossier', takePhoto: 'Prendre une photo',
    'name.folder': 'Nom du dossier', 'name.new': 'Nouveau nom',
    'sort.label': 'Trier, actuellement par {by}', 'sort.menu': 'Tri', 'sort.name': 'Nom', 'sort.updated': 'Modification', 'sort.size': 'Taille', 'sort.created': 'Création', 'sort.asc': 'Ordre croissant', 'sort.desc': 'Ordre décroissant',
    toList: 'Afficher en liste', toGrid: 'Afficher en grille',
    'col.name': 'Nom', 'col.updated': 'Modifié', 'col.size': 'Taille', 'section.folders': 'Dossiers', 'section.files': 'Fichiers',
    listLabel: 'Contenu : {name}', starred: 'Favori', infected: 'Fichier infecté', versionsN: '{n} version | {n} versions', viaPortal: 'Reçu via un portail de dépôt',
    infectedText: 'L’antivirus a signalé ce fichier. Il ne peut être ni prévisualisé ni partagé.', infectedDownload: '« {name} » a été signalé par l’antivirus. Le télécharger peut mettre votre appareil en danger.', infectedConfirm: 'Télécharger quand même',
    zipSkipsInfected: 'Les fichiers signalés par l’antivirus ne sont pas inclus dans l’archive.',
    actionsFor: 'Actions pour {name}', actionsForN: 'Actions pour {n} élément | Actions pour {n} éléments', openNamed: 'Ouvrir {name}', trashNamed: 'Mettre {name} à la corbeille',
    'a.restore': 'Restaurer', 'a.purge': 'Supprimer définitivement', 'a.details': 'Détails', 'a.reveal': 'Ouvrir l’emplacement', 'a.downloadZip': 'Télécharger (ZIP)', 'a.share': 'Partager', 'a.request': 'Créer un portail de dépôt',
    'a.rename': 'Renommer', 'a.move': 'Déplacer vers…', 'a.copy': 'Copier vers…', 'a.star': 'Ajouter aux favoris', 'a.unstar': 'Retirer des favoris', 'a.tags': 'Étiquettes…', 'a.trash': 'Mettre à la corbeille',
    'selection.label': 'Actions sur la sélection', 'selection.clear': 'Tout désélectionner', 'selection.n': '{n} sélectionné | {n} sélectionnés',
    starredDone: 'Ajouté aux favoris | {n} éléments ajoutés aux favoris', unstarredDone: 'Retiré des favoris | {n} éléments retirés des favoris',
    restored: 'Élément restauré | {n} éléments restaurés', trashedOne: '« {name} » mis à la corbeille', trashedN: '{n} élément mis à la corbeille | {n} éléments mis à la corbeille',
    moved: 'Élément déplacé vers « {name} » | {n} éléments déplacés vers « {name} »', copied: 'Élément copié vers « {name} » | {n} éléments copiés vers « {name} »', purged: 'Élément supprimé définitivement | {n} éléments supprimés définitivement',
    keepBoth: 'Garder les deux', dropHere: 'Déposez pour téléverser dans « {name} »', dropNothing: 'Aucun fichier lisible dans ce dépôt.',
    'trash.empty': 'Vider la corbeille', 'trash.emptyText': 'L’élément de la corbeille et tout son contenu seront supprimés définitivement. Cette action est irréversible. | Les {n} éléments de la corbeille et tout leur contenu seront supprimés définitivement. Cette action est irréversible.',
    'trash.emptied': 'Corbeille vidée', 'trash.note': 'Les éléments restent dans la corbeille, et comptent dans votre espace, jusqu’à leur suppression définitive.', 'trash.restoreFirst': 'Restaurez ce dossier pour l’ouvrir.',
    'purge.title': 'Supprimer définitivement ?', 'purge.textOne': '« {name} » et toutes ses versions seront supprimés. Cette action est irréversible.', 'purge.textN': '{n} élément et tout son contenu seront supprimés. Cette action est irréversible. | {n} éléments et tout leur contenu seront supprimés. Cette action est irréversible.',
    'notFound.title': 'Dossier introuvable', 'notFound.text': 'Ce dossier n’existe pas, a été supprimé ou ne vous appartient pas.', 'notFound.home': 'Retour à Mon Drive',
    'empty.folder': 'Ce dossier est vide', 'empty.folderText': 'Déposez des fichiers ou des dossiers ici, ou utilisez le bouton « Nouveau ».', 'empty.folderTextTouch': 'Utilisez le bouton « Nouveau » pour téléverser des fichiers ou prendre une photo.',
    'empty.trash': 'La corbeille est vide', 'empty.trashText': 'Les éléments supprimés apparaissent ici et peuvent être restaurés.',
    'empty.search': 'Aucun résultat', 'empty.searchText': 'Essayez un autre nom ou retirez des filtres.', 'empty.starred': 'Aucun favori', 'empty.starredText': 'Ajoutez un fichier ou un dossier aux favoris pour le retrouver ici.',
    'empty.recent': 'Aucun fichier récent', 'empty.recentText': 'Les fichiers ajoutés ou modifiés récemment apparaissent ici.', 'empty.duplicates': 'Aucun doublon', 'empty.duplicatesText': 'Aucun fichier de votre espace n’a le même contenu qu’un autre.',
    searchCapped: 'Seuls les premiers résultats sont affichés. Précisez la recherche pour en voir moins.',
    'filters.label': 'Filtres de recherche', 'filters.toggle': 'Filtres', 'filters.toggleN': 'Filtres ({n})', 'filters.q': 'Nom', 'filters.qPlaceholder': 'Nom de fichier ou de dossier', 'filters.kind': 'Type', 'filters.tag': 'Étiquette', 'filters.anyTag': 'Toutes', 'filters.from': 'Modifié du', 'filters.to': 'au', 'filters.starred': 'Favoris seulement',
    'filters.kind.any': 'Tous', 'filters.kind.folder': 'Dossiers', 'filters.kind.image': 'Images', 'filters.kind.pdf': 'PDF', 'filters.kind.document': 'Documents', 'filters.kind.sheet': 'Tableurs', 'filters.kind.video': 'Vidéos', 'filters.kind.audio': 'Audio', 'filters.kind.archive': 'Archives', 'filters.kind.text': 'Texte',
    'kind.folder': 'Dossier', 'kind.pdf': 'Document PDF', 'kind.image': 'Image', 'kind.heic': 'Image HEIC', 'kind.svg': 'Image vectorielle', 'kind.video': 'Vidéo', 'kind.audio': 'Audio', 'kind.text': 'Texte', 'kind.markdown': 'Markdown', 'kind.csv': 'Données CSV', 'kind.json': 'Données JSON',
    'kind.office': 'Document bureautique', 'kind.sheet': 'Classeur', 'kind.archive': 'Archive', 'kind.none': 'Fichier',
    'd.type': 'Type', 'd.size': 'Taille', 'd.bytes': '{n} octets', 'd.updated': 'Modifié', 'd.created': 'Créé', 'd.trashed': 'Supprimé', 'd.location': 'Emplacement', 'd.copySha': 'Copier l’empreinte SHA-256', 'd.tags': 'Étiquettes',
    'd.shares': 'Partage', 'd.sharesN': '{n} lien actif | {n} liens actifs', 'd.sharesNone': 'Aucun lien actif', 'd.manageShares': 'Gérer',
    'ver.title': 'Versions ({n})', 'ver.n': 'Version {n}', 'ver.current': 'Actuelle', 'ver.download': 'Télécharger la version {n}', 'ver.restore': 'Restaurer la version {n}', 'ver.delete': 'Supprimer la version {n}',
    'ver.restored': 'Version {n} restaurée comme nouvelle version', 'ver.restoredFrom': 'restaurée depuis la version {n}', 'ver.upload': 'Téléverser une nouvelle version', 'ver.hint': 'Le fichier choisi remplace le contenu actuel ; les versions précédentes restent disponibles ici.',
    'ver.deleteTitle': 'Supprimer la version {n} ?', 'ver.deleteText': 'Cette version sera supprimée définitivement. Les autres versions ne sont pas touchées.',
    'pick.moveTitle': 'Déplacer {n} élément | Déplacer {n} éléments', 'pick.copyTitle': 'Copier {n} élément | Copier {n} éléments', 'pick.moveHere': 'Déplacer ici', 'pick.copyHere': 'Copier ici', 'pick.tree': 'Dossiers', 'pick.expand': 'Développer {name}', 'pick.collapse': 'Réduire {name}',
    'pick.dest': 'Destination : {name}', 'pick.newIn': 'Nouveau dossier dans « {name} »', 'pick.conflict': 'Un élément nommé « {name} » existe déjà à cet endroit.', 'pick.keepBothHint': '« Garder les deux » déplace l’élément sous un nom numéroté.',
    'tags.title': 'Étiquettes de {name}', 'tags.done': 'Terminé', 'tags.empty': 'Aucune étiquette pour l’instant. Créez-en une ci-dessous.', 'tags.name': 'Nom de l’étiquette', 'tags.color': 'Couleur', 'tags.new': 'Nouvelle étiquette', 'tags.create': 'Créer et appliquer',
    'tags.exists': 'Une étiquette porte déjà ce nom.', 'tags.count': '{n} fichier | {n} fichiers', 'tags.edit': 'Modifier l’étiquette {name}', 'tags.delete': 'Supprimer l’étiquette {name}', 'tags.confirmDelete': 'Supprimer « {name} » ? Elle sera retirée de {n} fichier. | Supprimer « {name} » ? Elle sera retirée de {n} fichiers.',
    'color.slate': 'Gris', 'color.red': 'Rouge', 'color.orange': 'Orange', 'color.amber': 'Ambre', 'color.green': 'Vert', 'color.teal': 'Sarcelle', 'color.blue': 'Bleu', 'color.violet': 'Violet', 'color.pink': 'Rose',
    'dup.summary': '{n} groupe de fichiers identiques · {size} récupérables | {n} groupes de fichiers identiques · {size} récupérables', 'dup.note': 'Les copies identiques ne sont stockées qu’une fois ; les retirer allège surtout vos dossiers.', 'dup.copies': '{n} copie | {n} copies', 'dup.each': '{size} chacune', 'dup.saved': '{size} en double',
    'dup.trashExtra': 'Mettre la copie en trop à la corbeille | Mettre les {n} copies en trop à la corbeille', 'dup.kept': 'La plus ancienne', 'dup.more': 'Afficher {n} groupe de plus | Afficher {n} groupes de plus',
    'conflict.title': 'Ce nom existe déjà', 'conflict.text': 'Un élément nommé « {name} » existe déjà dans le dossier de destination. Que faire du fichier envoyé ?', 'conflict.version': 'Remplacer (nouvelle version)', 'conflict.keepBoth': 'Garder les deux', 'conflict.skip': 'Ignorer',
    'conflict.applyAll': 'Appliquer à tous les conflits de cet envoi',
    'up.label': 'Téléversements', 'up.titleActive': 'Téléversement de {n} fichier… | Téléversement de {n} fichiers…', 'up.titleFailed': '{n} téléversement en échec | {n} téléversements en échec', 'up.titlePaused': '{n} téléversement en pause | {n} téléversements en pause',
    'up.titleDone': '{n} fichier téléversé | {n} fichiers téléversés', 'up.titlePending': '{n} téléversement interrompu | {n} téléversements interrompus', 'up.overall': 'Progression globale', 'up.clear': 'Tout effacer', 'up.collapse': 'Réduire', 'up.expand': 'Développer',
    'up.queued': 'En attente', 'up.progress': '{sent} sur {total}', 'up.paused': 'En pause', 'up.finishing': 'Vérification…', 'up.conflictWaiting': 'En attente de votre choix (nom déjà utilisé)', 'up.skipped': 'Ignoré', 'up.done': 'Terminé', 'up.doneVersion': 'Nouvelle version enregistrée', 'up.doneAs': 'Enregistré sous « {name} »',
    'up.resumedAt': 'repris à {pct} %', 'up.etaSoon': 'presque fini', 'up.etaS': '{n} s restantes', 'up.etaM': '{n} min restantes', 'up.etaH': '{n} h restantes',
    'up.pause': 'Mettre en pause', 'up.resume': 'Reprendre', 'up.cancel': 'Annuler le téléversement', 'up.remove': 'Retirer de la liste', 'up.forget': 'Abandonner',
    'up.pendingTitle': '{n} envoi interrompu | {n} envois interrompus', 'up.pendingText': 'Ces envois ont été interrompus quand la page a été fermée ou rechargée. Choisissez de nouveau les mêmes fichiers, dans le même dossier, pour reprendre là où ils s’étaient arrêtés.', 'up.pendingHide': 'Masquer',
    'up.note': 'Les envois se poursuivent tant que cette page reste ouverte, y compris en changeant de dossier. Rien n’est envoyé en arrière-plan une fois la page fermée.',
  },
  en: {
    root: 'My Drive', breadcrumbs: 'Breadcrumbs', crumbsHidden: '{n} hidden parent folder | {n} hidden parent folders',
    'view.recent': 'Recent', 'view.starred': 'Starred', 'view.trash': 'Trash', 'view.search': 'Search', 'view.duplicates': 'Duplicates',
    new: 'New', newFolder: 'New folder', uploadFiles: 'Upload files', uploadFolder: 'Upload a folder', takePhoto: 'Take a photo',
    'name.folder': 'Folder name', 'name.new': 'New name',
    'sort.label': 'Sort, currently by {by}', 'sort.menu': 'Sort', 'sort.name': 'Name', 'sort.updated': 'Modified', 'sort.size': 'Size', 'sort.created': 'Created', 'sort.asc': 'Ascending', 'sort.desc': 'Descending',
    toList: 'Show as list', toGrid: 'Show as grid',
    'col.name': 'Name', 'col.updated': 'Modified', 'col.size': 'Size', 'section.folders': 'Folders', 'section.files': 'Files',
    listLabel: 'Contents: {name}', starred: 'Starred', infected: 'Infected file', versionsN: '{n} version | {n} versions', viaPortal: 'Received through a deposit portal',
    infectedText: 'The antivirus flagged this file. It cannot be previewed or shared.', infectedDownload: '“{name}” was flagged by the antivirus. Downloading it may put your device at risk.', infectedConfirm: 'Download anyway',
    zipSkipsInfected: 'Files flagged by the antivirus are left out of the archive.',
    actionsFor: 'Actions for {name}', actionsForN: 'Actions for {n} item | Actions for {n} items', openNamed: 'Open {name}', trashNamed: 'Move {name} to the trash',
    'a.restore': 'Restore', 'a.purge': 'Delete permanently', 'a.details': 'Details', 'a.reveal': 'Open location', 'a.downloadZip': 'Download (ZIP)', 'a.share': 'Share', 'a.request': 'Create a deposit portal',
    'a.rename': 'Rename', 'a.move': 'Move to…', 'a.copy': 'Copy to…', 'a.star': 'Add to starred', 'a.unstar': 'Remove from starred', 'a.tags': 'Tags…', 'a.trash': 'Move to trash',
    'selection.label': 'Actions on the selection', 'selection.clear': 'Clear selection', 'selection.n': '{n} selected | {n} selected',
    starredDone: 'Added to starred | {n} items added to starred', unstarredDone: 'Removed from starred | {n} items removed from starred',
    restored: 'Item restored | {n} items restored', trashedOne: '“{name}” moved to the trash', trashedN: '{n} item moved to the trash | {n} items moved to the trash',
    moved: 'Item moved to “{name}” | {n} items moved to “{name}”', copied: 'Item copied to “{name}” | {n} items copied to “{name}”', purged: 'Item permanently deleted | {n} items permanently deleted',
    keepBoth: 'Keep both', dropHere: 'Drop to upload to “{name}”', dropNothing: 'No readable file in this drop.',
    'trash.empty': 'Empty the trash', 'trash.emptyText': 'The item in the trash and everything in it will be deleted permanently. This cannot be undone. | The {n} items in the trash and everything in them will be deleted permanently. This cannot be undone.',
    'trash.emptied': 'Trash emptied', 'trash.note': 'Items stay in the trash, and count towards your storage, until they are permanently deleted.', 'trash.restoreFirst': 'Restore this folder to open it.',
    'purge.title': 'Delete permanently?', 'purge.textOne': '“{name}” and all its versions will be deleted. This cannot be undone.', 'purge.textN': '{n} item and everything in it will be deleted. This cannot be undone. | {n} items and everything in them will be deleted. This cannot be undone.',
    'notFound.title': 'Folder not found', 'notFound.text': 'This folder does not exist, was deleted, or is not yours.', 'notFound.home': 'Back to My Drive',
    'empty.folder': 'This folder is empty', 'empty.folderText': 'Drop files or folders here, or use the “New” button.', 'empty.folderTextTouch': 'Use the “New” button to upload files or take a photo.',
    'empty.trash': 'The trash is empty', 'empty.trashText': 'Deleted items appear here and can be restored.',
    'empty.search': 'No results', 'empty.searchText': 'Try another name or remove some filters.', 'empty.starred': 'Nothing starred', 'empty.starredText': 'Star a file or a folder to find it here.',
    'empty.recent': 'No recent files', 'empty.recentText': 'Files added or changed recently appear here.', 'empty.duplicates': 'No duplicates', 'empty.duplicatesText': 'No file in your space has the same content as another.',
    searchCapped: 'Only the first results are shown. Narrow the search to see fewer.',
    'filters.label': 'Search filters', 'filters.toggle': 'Filters', 'filters.toggleN': 'Filters ({n})', 'filters.q': 'Name', 'filters.qPlaceholder': 'File or folder name', 'filters.kind': 'Type', 'filters.tag': 'Tag', 'filters.anyTag': 'Any', 'filters.from': 'Modified from', 'filters.to': 'to', 'filters.starred': 'Starred only',
    'filters.kind.any': 'All', 'filters.kind.folder': 'Folders', 'filters.kind.image': 'Images', 'filters.kind.pdf': 'PDF', 'filters.kind.document': 'Documents', 'filters.kind.sheet': 'Spreadsheets', 'filters.kind.video': 'Videos', 'filters.kind.audio': 'Audio', 'filters.kind.archive': 'Archives', 'filters.kind.text': 'Text',
    'kind.folder': 'Folder', 'kind.pdf': 'PDF document', 'kind.image': 'Image', 'kind.heic': 'HEIC image', 'kind.svg': 'Vector image', 'kind.video': 'Video', 'kind.audio': 'Audio', 'kind.text': 'Text', 'kind.markdown': 'Markdown', 'kind.csv': 'CSV data', 'kind.json': 'JSON data',
    'kind.office': 'Office document', 'kind.sheet': 'Workbook', 'kind.archive': 'Archive', 'kind.none': 'File',
    'd.type': 'Type', 'd.size': 'Size', 'd.bytes': '{n} bytes', 'd.updated': 'Modified', 'd.created': 'Created', 'd.trashed': 'Deleted', 'd.location': 'Location', 'd.copySha': 'Copy the SHA-256 checksum', 'd.tags': 'Tags',
    'd.shares': 'Sharing', 'd.sharesN': '{n} active link | {n} active links', 'd.sharesNone': 'No active link', 'd.manageShares': 'Manage',
    'ver.title': 'Versions ({n})', 'ver.n': 'Version {n}', 'ver.current': 'Current', 'ver.download': 'Download version {n}', 'ver.restore': 'Restore version {n}', 'ver.delete': 'Delete version {n}',
    'ver.restored': 'Version {n} restored as a new version', 'ver.restoredFrom': 'restored from version {n}', 'ver.upload': 'Upload a new version', 'ver.hint': 'The chosen file replaces the current content; earlier versions stay available here.',
    'ver.deleteTitle': 'Delete version {n}?', 'ver.deleteText': 'This version will be deleted permanently. Other versions are not affected.',
    'pick.moveTitle': 'Move {n} item | Move {n} items', 'pick.copyTitle': 'Copy {n} item | Copy {n} items', 'pick.moveHere': 'Move here', 'pick.copyHere': 'Copy here', 'pick.tree': 'Folders', 'pick.expand': 'Expand {name}', 'pick.collapse': 'Collapse {name}',
    'pick.dest': 'Destination: {name}', 'pick.newIn': 'New folder in “{name}”', 'pick.conflict': 'An item named “{name}” already exists there.', 'pick.keepBothHint': '“Keep both” moves the item under a numbered name.',
    'tags.title': 'Tags of {name}', 'tags.done': 'Done', 'tags.empty': 'No tags yet. Create one below.', 'tags.name': 'Tag name', 'tags.color': 'Colour', 'tags.new': 'New tag', 'tags.create': 'Create and apply',
    'tags.exists': 'A tag with this name already exists.', 'tags.count': '{n} file | {n} files', 'tags.edit': 'Edit tag {name}', 'tags.delete': 'Delete tag {name}', 'tags.confirmDelete': 'Delete “{name}”? It will be removed from {n} file. | Delete “{name}”? It will be removed from {n} files.',
    'color.slate': 'Grey', 'color.red': 'Red', 'color.orange': 'Orange', 'color.amber': 'Amber', 'color.green': 'Green', 'color.teal': 'Teal', 'color.blue': 'Blue', 'color.violet': 'Violet', 'color.pink': 'Pink',
    'dup.summary': '{n} group of identical files · {size} recoverable | {n} groups of identical files · {size} recoverable', 'dup.note': 'Identical copies are stored only once; removing them mostly tidies your folders.', 'dup.copies': '{n} copy | {n} copies', 'dup.each': '{size} each', 'dup.saved': '{size} duplicated',
    'dup.trashExtra': 'Move the extra copy to the trash | Move the {n} extra copies to the trash', 'dup.kept': 'Oldest', 'dup.more': 'Show {n} more group | Show {n} more groups',
    'conflict.title': 'This name already exists', 'conflict.text': 'An item named “{name}” already exists in the destination folder. What should happen to the uploaded file?', 'conflict.version': 'Replace (new version)', 'conflict.keepBoth': 'Keep both', 'conflict.skip': 'Skip',
    'conflict.applyAll': 'Apply to every conflict of this upload',
    'up.label': 'Uploads', 'up.titleActive': 'Uploading {n} file… | Uploading {n} files…', 'up.titleFailed': '{n} upload failed | {n} uploads failed', 'up.titlePaused': '{n} upload paused | {n} uploads paused',
    'up.titleDone': '{n} file uploaded | {n} files uploaded', 'up.titlePending': '{n} interrupted upload | {n} interrupted uploads', 'up.overall': 'Overall progress', 'up.clear': 'Clear all', 'up.collapse': 'Collapse', 'up.expand': 'Expand',
    'up.queued': 'Waiting', 'up.progress': '{sent} of {total}', 'up.paused': 'Paused', 'up.finishing': 'Verifying…', 'up.conflictWaiting': 'Waiting for your choice (name already used)', 'up.skipped': 'Skipped', 'up.done': 'Done', 'up.doneVersion': 'New version saved', 'up.doneAs': 'Saved as “{name}”',
    'up.resumedAt': 'resumed at {pct}%', 'up.etaSoon': 'almost done', 'up.etaS': '{n} s left', 'up.etaM': '{n} min left', 'up.etaH': '{n} h left',
    'up.pause': 'Pause', 'up.resume': 'Resume', 'up.cancel': 'Cancel upload', 'up.remove': 'Remove from the list', 'up.forget': 'Discard',
    'up.pendingTitle': '{n} interrupted upload | {n} interrupted uploads', 'up.pendingText': 'These uploads were interrupted when the page was closed or reloaded. Pick the same files again, in the same folder, to continue where they stopped.', 'up.pendingHide': 'Hide',
    'up.note': 'Uploads continue as long as this page stays open, including while you change folders. Nothing is sent in the background once the page is closed.',
  },
};
