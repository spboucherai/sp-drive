/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/i18n/sharing.ts
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

// Owner-side screens: share links (dialog + /shares) and deposit portals (dialog + /requests + /requests/:id).
export const sharing: Dict = {
  fr: {
    saved: 'Modifications enregistrées.', refresh: 'Actualiser',
    // --- link shown once ---
    'link.label': 'Lien', 'link.once': 'Copiez ce lien maintenant : il ne sera plus jamais affiché. Seule son empreinte est conservée ; en cas de perte, générez un nouveau lien.',
    'link.qr': 'Code QR du lien', 'link.qrHint': 'Scannez pour ouvrir le lien sur un téléphone.', 'link.native': 'Partager…', 'link.newTitle': 'Nouveau lien', 'link.done': 'Terminé',
    // --- expiry ---
    'expiry.label': 'Expiration', 'expiry.never': 'Jamais', 'expiry.1': '1 jour', 'expiry.7': '7 jours', 'expiry.30': '30 jours', 'expiry.date': 'Date précise',
    // --- share form ---
    'form.label': 'Libellé', 'form.labelHint': 'Pour vous y retrouver (ex. « Comptable 2026 »). Le visiteur le voit aussi.', 'form.create': 'Créer un lien',
    'form.canDownload': 'Autoriser le téléchargement', 'form.canDownloadOn': 'Le visiteur peut consulter et télécharger.',
    'form.canDownloadOff': 'Lecture seule : aucun bouton de téléchargement n’est proposé et le serveur refuse l’envoi du fichier original. Cela n’empêche pas une capture d’écran de ce qui est affiché.',
    'form.password': 'Mot de passe (facultatif)', 'form.passwordHint': 'Au moins 4 caractères. Transmettez-le par un autre canal que le lien.', 'form.passwordChange': 'Nouveau mot de passe',
    'form.passwordKeep': 'Laissez vide pour conserver le mot de passe actuel.', 'form.passwordRemove': 'Retirer le mot de passe', 'form.passwordShort': 'Le mot de passe doit compter au moins 4 caractères.',
    'form.maxViews': 'Consultations max.', 'form.maxDownloads': 'Téléchargements max.', 'form.unlimited': 'Illimité', 'form.singleUse': 'Usage unique',
    'form.singleUseHint': 'Le lien cesse de fonctionner après la première ouverture.', 'form.badNumber': 'Entrez un nombre entier supérieur à zéro, ou laissez vide.', 'form.badDate': 'Choisissez une date valide.',
    // --- share dialog ---
    'dialog.title': 'Partager « {name} »', 'dialog.count': '{n} lien | {n} liens', 'dialog.created': 'Lien créé.', 'dialog.createIntro': 'Chaque lien a ses propres règles et peut être révoqué séparément.',
    'dialog.emptyIntro': 'Aucun lien pour cet élément. Créez-en un : toute personne qui le détient pourra y accéder sans compte, selon les règles ci-dessous.',
    // --- one link ---
    'item.untitled': 'Lien sans libellé', 'item.actions': 'Actions pour {name}', 'item.download': 'Téléchargement autorisé', 'item.viewOnly': 'Lecture seule', 'item.password': 'Mot de passe', 'item.singleUse': 'Usage unique',
    'item.expires': 'Expire le {date}', 'item.expired': 'Expiré le {date}', 'item.noExpiry': 'Sans expiration', 'item.views': '{n} consultation | {n} consultations', 'item.downloads': '{n} téléchargement | {n} téléchargements',
    'item.lastAccess': 'dernier accès {when}', 'item.neverUsed': 'jamais utilisé', 'item.created': 'créé le {date}',
    'item.edit': 'Modifier les réglages', 'item.editTitle': 'Réglages du lien', 'item.rotate': 'Nouveau lien', 'item.rotateConfirm': 'Générer un nouveau lien',
    'item.rotateText': 'Un nouveau lien est généré avec les mêmes réglages. L’ancien lien cesse de fonctionner immédiatement, y compris pour les personnes qui l’ont déjà.',
    'item.journal': 'Journal d’accès', 'item.revoke': 'Révoquer', 'item.revokeText': 'Le lien cesse de fonctionner immédiatement, même pour une personne qui a la page ouverte. Cette action est définitive ; le journal est conservé.',
    'item.revoked': 'Lien révoqué.', 'item.purge': 'Supprimer', 'item.purgeText': 'Le lien et son journal d’accès sont supprimés définitivement. Le fichier ou le dossier partagé n’est pas touché.', 'item.purged': 'Lien supprimé.',
    'status.active': 'Actif', 'status.revoked': 'Révoqué', 'status.expired': 'Expiré', 'status.exhausted': 'Épuisé', 'status.target_missing': 'Cible absente',
    'statusHint.active': 'Le lien fonctionne.', 'statusHint.revoked': 'Révoqué : le lien ne fonctionne plus.', 'statusHint.expired': 'La date d’expiration est passée : le lien ne fonctionne plus. Modifiez l’expiration pour le rouvrir.',
    'statusHint.exhausted': 'La limite de consultations ou de téléchargements est atteinte (ou le lien à usage unique a servi).', 'statusHint.target_missing': 'L’élément partagé est dans la corbeille ou supprimé : le lien ne mène nulle part.',
    // --- journal ---
    'events.title': 'Journal d’accès — {name}', 'events.empty': 'Aucun accès pour l’instant.', 'events.open': 'Ouverture', 'events.password': 'Mot de passe', 'events.download': 'Téléchargement',
    'events.ok': 'Accepté', 'events.refused': 'Refusé', 'events.refusedLimit': 'Refusé — limite atteinte', 'events.unknownDevice': 'appareil inconnu',
    // --- /shares ---
    'shares.title': 'Liens de partage', 'shares.intro': 'Tous les liens publics de votre compte. Chacun peut être modifié, renouvelé ou révoqué à tout moment.', 'shares.filter': 'Filtrer par état', 'shares.all': 'Tous',
    'shares.empty': 'Aucun lien de partage', 'shares.emptyText': 'Partagez un fichier ou un dossier depuis l’explorateur : le lien apparaîtra ici avec son journal d’accès.',
    'shares.noneForFilter': 'Aucun lien dans cet état.', 'shares.targetGone': 'Élément supprimé', 'shares.manageFile': 'Gérer les liens de ce fichier',
    // --- portal form ---
    'portal.newTitle': 'Nouveau portail de dépôt', 'portal.editTitle': 'Modifier le portail', 'portal.create': 'Créer le portail', 'portal.createdTitle': 'Portail créé', 'portal.created': 'Le portail est ouvert. Les dépôts arriveront dans « {folder} ».',
    'portal.rotated': 'Nouveau lien généré. L’ancien ne fonctionne plus.', 'portal.target': 'Les fichiers déposés arrivent dans « {folder} »',
    'portal.sPresentation': 'Présentation', 'portal.title': 'Titre', 'portal.titlePh': 'Dépôt de documents', 'portal.titleRequired': 'Donnez un titre au portail.', 'portal.description': 'Description',
    'portal.descriptionHint': 'Une ou deux phrases sous le titre.', 'portal.instructions': 'Consignes', 'portal.instructionsHint': 'Texte simple ; les retours à la ligne sont conservés.',
    'portal.sAppearance': 'Apparence', 'portal.brandName': 'Nom affiché', 'portal.brandNameHint': 'Votre nom ou celui de votre organisation, au-dessus du titre.', 'portal.brandColor': 'Couleur d’accent',
    'portal.preview': 'Aperçu de l’en-tête public', 'portal.previewHint': 'Aperçu de l’en-tête que verront les déposants. Le texte passe en clair ou en foncé selon la couleur.',
    'portal.sAccess': 'Accès', 'portal.active': 'Portail actif', 'portal.activeOn': 'Le portail accepte les dépôts.', 'portal.activeOff': 'En pause : le lien affiche que le portail n’accepte plus de dépôts.',
    'portal.passwordHint': 'Au moins 4 caractères. Sans mot de passe, toute personne qui a le lien peut déposer.', 'portal.expires': 'Date d’expiration', 'portal.expiresHint': 'Vide : le portail reste ouvert jusqu’à ce que vous le fermiez.', 'portal.noExpiry': 'Aucune',
    'portal.linkHidden': 'Le lien public ne peut pas être réaffiché (seule son empreinte est conservée). S’il est perdu, générez-en un nouveau.', 'portal.rotate': 'Générer un nouveau lien',
    'portal.rotateText': 'Un nouveau lien est généré pour ce portail. L’ancien lien cesse de fonctionner immédiatement ; les envois déjà commencés peuvent se terminer.',
    'portal.sLimits': 'Limites', 'portal.maxFileMb': 'Taille max. par fichier', 'portal.maxFileMbHint': 'Jusqu’à 2 048 Mo.', 'portal.mb': 'Mo', 'portal.gb': 'Go', 'portal.maxFiles': 'Fichiers par dépôt',
    'portal.maxTotalGb': 'Volume total du portail', 'portal.maxTotalGbHint': 'Compté dans votre quota de stockage.', 'portal.maxSubmissions': 'Nombre max. de dépôts', 'portal.perHour': 'Dépôts par heure et par adresse',
    'portal.perHourHint': 'Frein contre les abus depuis une même adresse IP.', 'portal.range': 'Entrez une valeur entre {min} et {max}.',
    'portal.sTypes': 'Types de fichiers', 'portal.typesHint': 'Les programmes et les scripts (.exe, .dmg, .js, .html…) sont toujours refusés, et le contenu de chaque fichier est vérifié à la réception.',
    'portal.presets': 'Préréglages', 'portal.preset.documents': 'Documents', 'portal.preset.images': 'Images', 'portal.preset.pdf': 'PDF seulement', 'portal.preset.any': 'Tout sauf exécutables',
    'portal.extList': 'Extensions autorisées', 'portal.extAny': 'Toutes les extensions sont acceptées, sauf les programmes et les scripts.', 'portal.extAdd': 'Ajouter une extension', 'portal.extAddHint': 'Plusieurs à la fois, séparées par une virgule.',
    'portal.extAddBtn': 'Ajouter', 'portal.extRemove': 'Retirer .{ext}', 'portal.extBad': '« {ext} » n’est pas une extension valide (lettres et chiffres, 10 au plus).', 'portal.extBlocked': '.{ext} est un type exécutable : il est toujours refusé.', 'portal.extMany': '60 extensions au plus.',
    'portal.sForm': 'Formulaire', 'portal.formHint': 'Ce que le déposant doit indiquer avant d’envoyer.', 'portal.field.name': 'Nom', 'portal.field.email': 'Courriel', 'portal.field.reference': 'Référence',
    'portal.mode.off': 'Masqué', 'portal.mode.optional': 'Facultatif', 'portal.mode.required': 'Obligatoire', 'portal.customAdd': 'Ajouter un champ personnalisé', 'portal.customLabel': 'Champ personnalisé {n}',
    'portal.customRemove': 'Retirer le champ personnalisé {n}', 'portal.customLabelRequired': 'Donnez un libellé à ce champ ou retirez-le.',
    'portal.sConsent': 'Consentement et conservation', 'portal.requireConsent': 'Exiger un consentement', 'portal.requireConsentHint': 'Une case à cocher obligatoire ; la date et l’heure du consentement sont consignées.',
    'portal.consentText': 'Texte du consentement', 'portal.consentTextHint': 'Vide : une formule générique est affichée.', 'portal.retentionNote': 'Note de conservation', 'portal.retentionNoteHint': 'Ex. « Les documents sont conservés 12 mois puis détruits. »',
    'portal.sAfter': 'Après le dépôt', 'portal.subfolder': 'Un sous-dossier par dépôt', 'portal.subfolderOn': 'Chaque dépôt arrive dans son propre sous-dossier, nommé d’après la date, le nom du déposant et la référence.',
    'portal.subfolderOff': 'Tous les fichiers arrivent directement dans le dossier cible ; les homonymes sont renommés.', 'portal.notify': 'Me notifier à chaque dépôt', 'portal.notifyHint': 'Une notification dans SP Drive à la fin de l’analyse de chaque dépôt.',
    'portal.confirmation': 'Message de confirmation', 'portal.confirmationHint': 'Affiché au déposant sur son reçu.',
    'portal.pause': 'Mettre en pause', 'portal.resume': 'Réactiver', 'portal.paused': 'Portail mis en pause.', 'portal.resumed': 'Portail réactivé.',
    'portal.revokeTitle': 'Révoquer le portail', 'portal.revokeText': 'Le lien est fermé définitivement. Les envois en cours sont refusés à leur prochain bloc et rien de ce qu’ils transféraient n’est déposé. Les dépôts déjà reçus et leur journal sont conservés.',
    'portal.revoked': 'Portail révoqué.', 'portal.purgeTitle': 'Supprimer le portail', 'portal.purgeText': 'Le portail, la liste de ses dépôts et leur journal sont supprimés définitivement. Les fichiers déjà déposés restent dans votre dossier.', 'portal.purged': 'Portail supprimé.',
    'pstate.open': 'Ouvert', 'pstate.paused': 'En pause', 'pstate.revoked': 'Révoqué', 'pstate.expired': 'Expiré', 'pstate.full': 'Plein', 'pstate.target_missing': 'Dossier absent',
    'pstateHint.open': 'Le portail accepte les dépôts.', 'pstateHint.paused': 'En pause : aucun dépôt n’est accepté tant que vous ne le réactivez pas.', 'pstateHint.revoked': 'Révoqué : le lien est fermé définitivement.',
    'pstateHint.expired': 'La date d’expiration est passée. Repoussez-la pour rouvrir le portail.', 'pstateHint.full': 'Le volume total ou le nombre maximal de dépôts est atteint. Augmentez la limite pour rouvrir.',
    'pstateHint.target_missing': 'Le dossier cible est dans la corbeille : les dépôts sont refusés. Restaurez le dossier.',
    // --- /requests ---
    'requests.title': 'Portails de dépôt', 'requests.intro': 'Recevez des fichiers de personnes sans compte, directement dans un dossier.', 'requests.new': 'Nouveau portail',
    'requests.empty': 'Aucun portail de dépôt', 'requests.emptyText': 'Un portail est une page publique où une personne sans compte vous envoie des fichiers, qui arrivent dans le dossier de votre choix après vérification antivirus. Le déposant ne voit rien de votre espace : ni le dossier, ni les autres dépôts.',
    'requests.deposits': 'Dépôts', 'requests.volume': 'Volume reçu', 'requests.expiry': 'Expiration', 'requests.view': 'Voir les dépôts',
    'picker.title': 'Dossier de destination', 'picker.intro': 'Choisissez le dossier où arriveront les fichiers déposés.', 'picker.confirm': 'Choisir ce dossier', 'picker.root': 'Mon Drive', 'picker.expand': 'Développer {name}', 'picker.collapse': 'Réduire {name}',
    // --- /requests/:id ---
    'detail.limits': 'Limites', 'detail.perFile': '{size} par fichier', 'detail.files': '{n} fichier par dépôt | {n} fichiers par dépôt', 'detail.perHour': '{n} dépôt/h par adresse | {n} dépôts/h par adresse',
    'detail.noFields': 'Aucun champ', 'detail.noPassword': 'Sans mot de passe', 'detail.consent': 'Consentement exigé', 'detail.subfolder': 'Un sous-dossier par dépôt', 'detail.flat': 'Directement dans le dossier', 'detail.notify': 'Notifications activées', 'detail.noNotify': 'Sans notification',
    'detail.submissions': 'Dépôts reçus', 'detail.empty': 'Aucun dépôt pour l’instant', 'detail.emptyText': 'Les dépôts apparaîtront ici dès qu’une personne utilisera le lien du portail.',
    'detail.ref': 'Référence', 'detail.depositor': 'Déposant', 'detail.date': 'Date', 'detail.status': 'Statut', 'detail.filesCol': 'Fichiers', 'detail.folder': 'Dossier', 'detail.anonymous': 'Non précisé',
    'detail.accepted': '{n} accepté | {n} acceptés', 'detail.refused': '{n} refusé | {n} refusés', 'detail.openFolder': 'Ouvrir le dossier', 'detail.openSub': 'Détail du dépôt {ref}', 'detail.subTitle': 'Dépôt {ref}',
    'detail.received': 'Commencé le {date}', 'detail.processed': 'traité à {date}', 'detail.answers': 'Réponses du déposant', 'detail.noAnswers': 'Aucune réponse au formulaire.', 'detail.consentAt': 'Consentement', 'detail.consentNone': 'Non demandé',
    'detail.origin': 'Adresse IP et appareil', 'detail.sentAs': 'envoyé sous le nom « {name} »', 'detail.itemPlaced': 'Accepté et rangé', 'detail.itemRejected': 'Refusé', 'detail.itemQuarantine': 'En quarantaine, analyse en cours', 'detail.itemUploading': 'Envoi en cours',
    'detail.journal': 'Journal',
    'sstatus.open': 'Envoi en cours', 'sstatus.processing': 'Analyse en cours', 'sstatus.completed': 'Terminé', 'sstatus.rejected': 'Refusé', 'sstatus.expired': 'Abandonné',
    'event.started': 'Dépôt commencé : {n} fichier(s) annoncé(s), {size}.', 'event.finalized': 'Envoi terminé : {n} fichier(s) placé(s) en quarantaine pour analyse.', 'event.finalizedPartial': 'Envoi terminé : {n} fichier(s) en quarantaine, {k} incomplet(s).',
    'event.itemRejected': '« {name} » refusé : {reason}', 'event.completed': 'Dépôt terminé : {n} fichier(s) rangé(s), {k} refusé(s).', 'event.rejected': 'Dépôt refusé : aucun fichier accepté.', 'event.rejectedWhy': 'Dépôt refusé : {reason}',
    'reject.type_not_allowed': 'type de fichier non autorisé par ce portail.', 'reject.incomplete': 'fichier reçu incomplet.', 'reject.executable': 'le contenu est un programme ou un script.',
    'reject.type_mismatch': 'le contenu ne correspond pas à l’extension annoncée.', 'reject.infected': 'menace détectée par l’antivirus.', 'reject.unscannable': 'l’antivirus n’a pas pu analyser le fichier.',
    'reject.target_unavailable': 'le dossier cible n’existait plus au moment du rangement.', 'reject.quota_exceeded': 'votre quota de stockage était insuffisant.', 'reject.expired': 'le dépôt n’a pas été terminé à temps.', 'reject.other': 'refusé par le serveur.',
  },
  en: {
    saved: 'Changes saved.', refresh: 'Refresh',
    'link.label': 'Link', 'link.once': 'Copy this link now: it will never be shown again. Only its fingerprint is kept; if it is lost, generate a new link.',
    'link.qr': 'QR code of the link', 'link.qrHint': 'Scan to open the link on a phone.', 'link.native': 'Share…', 'link.newTitle': 'New link', 'link.done': 'Done',
    'expiry.label': 'Expiry', 'expiry.never': 'Never', 'expiry.1': '1 day', 'expiry.7': '7 days', 'expiry.30': '30 days', 'expiry.date': 'Exact date',
    'form.label': 'Label', 'form.labelHint': 'To find it again (e.g. “Accountant 2026”). The visitor sees it too.', 'form.create': 'Create a link',
    'form.canDownload': 'Allow download', 'form.canDownloadOn': 'The visitor can view and download.',
    'form.canDownloadOff': 'View only: no download button is offered and the server refuses to send the original file. This does not prevent a screenshot of what is displayed.',
    'form.password': 'Password (optional)', 'form.passwordHint': 'At least 4 characters. Send it through another channel than the link.', 'form.passwordChange': 'New password',
    'form.passwordKeep': 'Leave empty to keep the current password.', 'form.passwordRemove': 'Remove the password', 'form.passwordShort': 'The password must be at least 4 characters long.',
    'form.maxViews': 'Max. views', 'form.maxDownloads': 'Max. downloads', 'form.unlimited': 'Unlimited', 'form.singleUse': 'Single use',
    'form.singleUseHint': 'The link stops working after it is opened once.', 'form.badNumber': 'Enter a whole number above zero, or leave empty.', 'form.badDate': 'Choose a valid date.',
    'dialog.title': 'Share “{name}”', 'dialog.count': '{n} link | {n} links', 'dialog.created': 'Link created.', 'dialog.createIntro': 'Each link has its own rules and can be revoked separately.',
    'dialog.emptyIntro': 'No link for this item yet. Create one: anyone holding it can access the item without an account, under the rules below.',
    'item.untitled': 'Unlabelled link', 'item.actions': 'Actions for {name}', 'item.download': 'Download allowed', 'item.viewOnly': 'View only', 'item.password': 'Password', 'item.singleUse': 'Single use',
    'item.expires': 'Expires {date}', 'item.expired': 'Expired {date}', 'item.noExpiry': 'No expiry', 'item.views': '{n} view | {n} views', 'item.downloads': '{n} download | {n} downloads',
    'item.lastAccess': 'last access {when}', 'item.neverUsed': 'never used', 'item.created': 'created {date}',
    'item.edit': 'Edit settings', 'item.editTitle': 'Link settings', 'item.rotate': 'New link', 'item.rotateConfirm': 'Generate a new link',
    'item.rotateText': 'A new link is generated with the same settings. The old link stops working at once, including for people who already have it.',
    'item.journal': 'Access log', 'item.revoke': 'Revoke', 'item.revokeText': 'The link stops working at once, even for someone who has the page open. This cannot be undone; the log is kept.',
    'item.revoked': 'Link revoked.', 'item.purge': 'Delete', 'item.purgeText': 'The link and its access log are deleted for good. The shared file or folder is not touched.', 'item.purged': 'Link deleted.',
    'status.active': 'Active', 'status.revoked': 'Revoked', 'status.expired': 'Expired', 'status.exhausted': 'Used up', 'status.target_missing': 'Target missing',
    'statusHint.active': 'The link works.', 'statusHint.revoked': 'Revoked: the link no longer works.', 'statusHint.expired': 'The expiry date has passed: the link no longer works. Change the expiry to reopen it.',
    'statusHint.exhausted': 'The view or download limit is reached (or the single-use link was used).', 'statusHint.target_missing': 'The shared item is in the trash or deleted: the link leads nowhere.',
    'events.title': 'Access log — {name}', 'events.empty': 'No access yet.', 'events.open': 'Opened', 'events.password': 'Password', 'events.download': 'Download',
    'events.ok': 'Accepted', 'events.refused': 'Refused', 'events.refusedLimit': 'Refused — limit reached', 'events.unknownDevice': 'unknown device',
    'shares.title': 'Share links', 'shares.intro': 'Every public link of your account. Each can be edited, renewed or revoked at any time.', 'shares.filter': 'Filter by state', 'shares.all': 'All',
    'shares.empty': 'No share link', 'shares.emptyText': 'Share a file or a folder from the explorer: the link will appear here with its access log.',
    'shares.noneForFilter': 'No link in this state.', 'shares.targetGone': 'Deleted item', 'shares.manageFile': 'Manage the links of this file',
    'portal.newTitle': 'New deposit portal', 'portal.editTitle': 'Edit the portal', 'portal.create': 'Create the portal', 'portal.createdTitle': 'Portal created', 'portal.created': 'The portal is open. Deposits will arrive in “{folder}”.',
    'portal.rotated': 'New link generated. The old one no longer works.', 'portal.target': 'Deposited files arrive in “{folder}”',
    'portal.sPresentation': 'Presentation', 'portal.title': 'Title', 'portal.titlePh': 'Document deposit', 'portal.titleRequired': 'Give the portal a title.', 'portal.description': 'Description',
    'portal.descriptionHint': 'One or two sentences under the title.', 'portal.instructions': 'Instructions', 'portal.instructionsHint': 'Plain text; line breaks are kept.',
    'portal.sAppearance': 'Appearance', 'portal.brandName': 'Display name', 'portal.brandNameHint': 'Your name or your organisation’s, above the title.', 'portal.brandColor': 'Accent colour',
    'portal.preview': 'Preview of the public header', 'portal.previewHint': 'Preview of the header depositors will see. The text turns light or dark depending on the colour.',
    'portal.sAccess': 'Access', 'portal.active': 'Portal active', 'portal.activeOn': 'The portal accepts deposits.', 'portal.activeOff': 'Paused: the link says the portal no longer accepts deposits.',
    'portal.passwordHint': 'At least 4 characters. Without a password, anyone with the link can deposit.', 'portal.expires': 'Expiry date', 'portal.expiresHint': 'Empty: the portal stays open until you close it.', 'portal.noExpiry': 'None',
    'portal.linkHidden': 'The public link cannot be shown again (only its fingerprint is kept). If it is lost, generate a new one.', 'portal.rotate': 'Generate a new link',
    'portal.rotateText': 'A new link is generated for this portal. The old link stops working at once; transfers already started can finish.',
    'portal.sLimits': 'Limits', 'portal.maxFileMb': 'Max. size per file', 'portal.maxFileMbHint': 'Up to 2,048 MB.', 'portal.mb': 'MB', 'portal.gb': 'GB', 'portal.maxFiles': 'Files per deposit',
    'portal.maxTotalGb': 'Total volume of the portal', 'portal.maxTotalGbHint': 'Counted in your storage quota.', 'portal.maxSubmissions': 'Max. number of deposits', 'portal.perHour': 'Deposits per hour per address',
    'portal.perHourHint': 'A brake against abuse from one IP address.', 'portal.range': 'Enter a value between {min} and {max}.',
    'portal.sTypes': 'File types', 'portal.typesHint': 'Programs and scripts (.exe, .dmg, .js, .html…) are always refused, and the content of every file is checked on arrival.',
    'portal.presets': 'Presets', 'portal.preset.documents': 'Documents', 'portal.preset.images': 'Images', 'portal.preset.pdf': 'PDF only', 'portal.preset.any': 'Anything but executables',
    'portal.extList': 'Allowed extensions', 'portal.extAny': 'Every extension is accepted, except programs and scripts.', 'portal.extAdd': 'Add an extension', 'portal.extAddHint': 'Several at once, separated by a comma.',
    'portal.extAddBtn': 'Add', 'portal.extRemove': 'Remove .{ext}', 'portal.extBad': '“{ext}” is not a valid extension (letters and digits, 10 at most).', 'portal.extBlocked': '.{ext} is an executable type: it is always refused.', 'portal.extMany': '60 extensions at most.',
    'portal.sForm': 'Form', 'portal.formHint': 'What the depositor must provide before sending.', 'portal.field.name': 'Name', 'portal.field.email': 'Email', 'portal.field.reference': 'Reference',
    'portal.mode.off': 'Hidden', 'portal.mode.optional': 'Optional', 'portal.mode.required': 'Required', 'portal.customAdd': 'Add a custom field', 'portal.customLabel': 'Custom field {n}',
    'portal.customRemove': 'Remove custom field {n}', 'portal.customLabelRequired': 'Give this field a label or remove it.',
    'portal.sConsent': 'Consent and retention', 'portal.requireConsent': 'Require consent', 'portal.requireConsentHint': 'A mandatory checkbox; the date and time of the consent are recorded.',
    'portal.consentText': 'Consent text', 'portal.consentTextHint': 'Empty: a generic sentence is shown.', 'portal.retentionNote': 'Retention note', 'portal.retentionNoteHint': 'E.g. “Documents are kept 12 months, then destroyed.”',
    'portal.sAfter': 'After the deposit', 'portal.subfolder': 'One subfolder per deposit', 'portal.subfolderOn': 'Each deposit arrives in its own subfolder, named after the date, the depositor’s name and the reference.',
    'portal.subfolderOff': 'All files arrive directly in the target folder; files with the same name are renamed.', 'portal.notify': 'Notify me of each deposit', 'portal.notifyHint': 'A notification in SP Drive once each deposit has been checked.',
    'portal.confirmation': 'Confirmation message', 'portal.confirmationHint': 'Shown to the depositor on the receipt.',
    'portal.pause': 'Pause', 'portal.resume': 'Reactivate', 'portal.paused': 'Portal paused.', 'portal.resumed': 'Portal reactivated.',
    'portal.revokeTitle': 'Revoke the portal', 'portal.revokeText': 'The link is closed for good. Transfers in progress are refused at their next block and nothing they were sending is deposited. Deposits already received and their log are kept.',
    'portal.revoked': 'Portal revoked.', 'portal.purgeTitle': 'Delete the portal', 'portal.purgeText': 'The portal, the list of its deposits and their log are deleted for good. Files already deposited stay in your folder.', 'portal.purged': 'Portal deleted.',
    'pstate.open': 'Open', 'pstate.paused': 'Paused', 'pstate.revoked': 'Revoked', 'pstate.expired': 'Expired', 'pstate.full': 'Full', 'pstate.target_missing': 'Folder missing',
    'pstateHint.open': 'The portal accepts deposits.', 'pstateHint.paused': 'Paused: no deposit is accepted until you reactivate it.', 'pstateHint.revoked': 'Revoked: the link is closed for good.',
    'pstateHint.expired': 'The expiry date has passed. Push it back to reopen the portal.', 'pstateHint.full': 'The total volume or the maximum number of deposits is reached. Raise the limit to reopen.',
    'pstateHint.target_missing': 'The target folder is in the trash: deposits are refused. Restore the folder.',
    'requests.title': 'Deposit portals', 'requests.intro': 'Receive files from people without an account, straight into a folder.', 'requests.new': 'New portal',
    'requests.empty': 'No deposit portal', 'requests.emptyText': 'A portal is a public page where someone without an account sends you files, which arrive in the folder of your choice after an antivirus check. The depositor sees nothing of your space: neither the folder nor the other deposits.',
    'requests.deposits': 'Deposits', 'requests.volume': 'Volume received', 'requests.expiry': 'Expiry', 'requests.view': 'View deposits',
    'picker.title': 'Destination folder', 'picker.intro': 'Choose the folder where deposited files will arrive.', 'picker.confirm': 'Choose this folder', 'picker.root': 'My Drive', 'picker.expand': 'Expand {name}', 'picker.collapse': 'Collapse {name}',
    'detail.limits': 'Limits', 'detail.perFile': '{size} per file', 'detail.files': '{n} file per deposit | {n} files per deposit', 'detail.perHour': '{n} deposit/h per address | {n} deposits/h per address',
    'detail.noFields': 'No field', 'detail.noPassword': 'No password', 'detail.consent': 'Consent required', 'detail.subfolder': 'One subfolder per deposit', 'detail.flat': 'Directly in the folder', 'detail.notify': 'Notifications on', 'detail.noNotify': 'No notification',
    'detail.submissions': 'Deposits received', 'detail.empty': 'No deposit yet', 'detail.emptyText': 'Deposits will appear here as soon as someone uses the portal link.',
    'detail.ref': 'Reference', 'detail.depositor': 'Depositor', 'detail.date': 'Date', 'detail.status': 'Status', 'detail.filesCol': 'Files', 'detail.folder': 'Folder', 'detail.anonymous': 'Not provided',
    'detail.accepted': '{n} accepted | {n} accepted', 'detail.refused': '{n} refused | {n} refused', 'detail.openFolder': 'Open the folder', 'detail.openSub': 'Details of deposit {ref}', 'detail.subTitle': 'Deposit {ref}',
    'detail.received': 'Started {date}', 'detail.processed': 'processed at {date}', 'detail.answers': 'Depositor’s answers', 'detail.noAnswers': 'No answer to the form.', 'detail.consentAt': 'Consent', 'detail.consentNone': 'Not requested',
    'detail.origin': 'IP address and device', 'detail.sentAs': 'sent as “{name}”', 'detail.itemPlaced': 'Accepted and filed', 'detail.itemRejected': 'Refused', 'detail.itemQuarantine': 'In quarantine, being checked', 'detail.itemUploading': 'Being sent',
    'detail.journal': 'Log',
    'sstatus.open': 'Sending', 'sstatus.processing': 'Being checked', 'sstatus.completed': 'Completed', 'sstatus.rejected': 'Refused', 'sstatus.expired': 'Abandoned',
    'event.started': 'Deposit started: {n} file(s) announced, {size}.', 'event.finalized': 'Transfer finished: {n} file(s) placed in quarantine for checking.', 'event.finalizedPartial': 'Transfer finished: {n} file(s) in quarantine, {k} incomplete.',
    'event.itemRejected': '“{name}” refused: {reason}', 'event.completed': 'Deposit completed: {n} file(s) filed, {k} refused.', 'event.rejected': 'Deposit refused: no file accepted.', 'event.rejectedWhy': 'Deposit refused: {reason}',
    'reject.type_not_allowed': 'file type not allowed by this portal.', 'reject.incomplete': 'file received incomplete.', 'reject.executable': 'the content is a program or a script.',
    'reject.type_mismatch': 'the content does not match the announced extension.', 'reject.infected': 'threat detected by the antivirus.', 'reject.unscannable': 'the antivirus could not scan the file.',
    'reject.target_unavailable': 'the target folder no longer existed when filing.', 'reject.quota_exceeded': 'your storage quota was insufficient.', 'reject.expired': 'the deposit was not completed in time.', 'reject.other': 'refused by the server.',
  },
};
