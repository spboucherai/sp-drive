/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/i18n/public.ts
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

// The two anonymous pages: /s/<token> (share link) and /request/<token> (deposit portal).
export const publicPages: Dict = {
  fr: {
    language: 'Langue', retry: 'Réessayer', optional: 'facultatif', password: 'Mot de passe',
    'err.network': 'Connexion impossible. Vérifiez le réseau et réessayez.', 'err.tooMany': 'Trop de tentatives. Patientez quelques minutes avant de réessayer.',
    'err.passwordInvalid': 'Mot de passe incorrect.', 'err.passwordRequired': 'Entrez le mot de passe.', 'err.generic': 'Une erreur est survenue. Réessayez.',

    // --- share link ---
    'share.title': 'Partage',
    'share.unavailable': 'Ce lien n’est pas disponible', 'share.unavailableText': 'Vérifiez l’adresse ou demandez un nouveau lien à la personne qui vous l’a envoyé.',
    'share.protected': 'Ce contenu est protégé', 'share.protectedText': 'Entrez le mot de passe qui vous a été communiqué pour y accéder.',
    'share.locked': 'Votre accès a expiré', 'share.lockedText': 'Par sécurité, l’accès est limité dans le temps. Rouvrez le lien pour continuer.', 'share.reopen': 'Rouvrir le lien',
    'share.open': 'Ouvrir', 'share.sharedBy': 'Partagé par {owner}', 'share.expires': 'Disponible jusqu’au {date}', 'share.viewOnly': 'Lecture seule',
    'share.viewOnlyText': 'Le téléchargement n’est pas proposé pour ce lien.', 'share.preview': 'Aperçu', 'share.download': 'Télécharger', 'share.downloadName': 'Télécharger {name}',
    'share.downloadAll': 'Tout télécharger (ZIP)', 'share.downloading': 'Téléchargement… {pct} %',
    'share.downloadLimit': 'La limite de téléchargements de ce lien est atteinte. Demandez un nouveau lien à la personne qui vous l’a envoyé.',
    'share.downloadForbidden': 'Le téléchargement n’est pas autorisé pour ce lien.', 'share.emptyZip': 'Ce dossier ne contient aucun fichier à télécharger.',
    'share.emptyFolder': 'Ce dossier est vide.', 'share.folderGone': 'Ce dossier n’existe plus. Retour au dossier partagé.', 'share.fileGone': 'Ce fichier n’est plus disponible.',
    'share.breadcrumb': 'Emplacement', 'share.viewList': 'Liste', 'share.viewGrid': 'Grille', 'share.openItem': 'Ouvrir {name}',
    'share.items': '{n} élément | {n} éléments', 'share.modified': 'Modifié le {date}', 'share.dismiss': 'Fermer le message',

    // --- deposit portal ---
    'portal.title': 'Dépôt de fichiers', 'portal.unavailable': 'Ce lien de dépôt n’est pas disponible', 'portal.unavailableText': 'Vérifiez l’adresse ou demandez un nouveau lien à la personne qui vous l’a envoyé.',
    'portal.closed': 'Ce portail n’accepte plus de dépôts', 'portal.closedText': 'La période de dépôt est terminée ou le portail a été mis en pause. Communiquez avec la personne qui vous a transmis ce lien.',
    'portal.instructions': 'Consignes', 'portal.rules': 'À savoir avant de déposer',
    'portal.typesAny': 'Tous les types de fichiers, sauf les programmes et les scripts', 'portal.types': 'Types acceptés : {list}',
    'portal.maxSize': '{size} maximum par fichier', 'portal.maxFiles': '{n} fichier par dépôt | Jusqu’à {n} fichiers par dépôt', 'portal.deadline': 'Date limite : {date}', 'portal.remaining': 'Espace restant : {size}',
    'portal.name': 'Votre nom', 'portal.email': 'Votre courriel', 'portal.reference': 'Référence', 'portal.referenceHint': 'Numéro de dossier, de commande ou autre référence utile.',
    'portal.passwordHint': 'Ce portail est protégé : entrez le mot de passe qui vous a été communiqué.',
    'portal.required': 'Ce champ est obligatoire.', 'portal.emailInvalid': 'Entrez une adresse courriel valide.', 'portal.requiredLegend': 'Les champs marqués d’un astérisque sont obligatoires.',
    'portal.files': 'Vos fichiers', 'portal.drop': 'Glissez vos fichiers ici', 'portal.dropTouch': 'Ajoutez vos fichiers', 'portal.dropActive': 'Déposez pour ajouter', 'portal.choose': 'Choisir des fichiers', 'portal.addMore': 'Ajouter d’autres fichiers', 'portal.photo': 'Prendre une photo',
    'portal.selected': '{n} fichier sélectionné · {size} | {n} fichiers sélectionnés · {size}', 'portal.remove': 'Retirer {name}', 'portal.removeInvalid': 'Retirer les fichiers refusés',
    'portal.noFiles': 'Ajoutez au moins un fichier.', 'portal.fixFiles': 'Retirez les fichiers refusés pour continuer.',
    'portal.tooMany': 'Ce portail accepte au plus {max} fichiers par dépôt ; vous en avez sélectionné {n}.', 'portal.overTotal': 'Le total sélectionné ({size}) dépasse l’espace encore disponible sur ce portail ({max}).',
    'portal.fileType': 'Type de fichier non accepté (.{ext})', 'portal.fileTypeNone': 'Type de fichier non accepté (sans extension)', 'portal.fileBlocked': 'Les programmes et les scripts ne sont jamais acceptés (.{ext})',
    'portal.fileTooLarge': 'Trop volumineux : {size} (maximum {max})', 'portal.fileEmpty': 'Fichier vide',
    'portal.consentRequired': 'Vous devez donner votre consentement pour envoyer.', 'portal.consentDefault': 'J’accepte que les fichiers et les renseignements fournis soient transmis au destinataire.',
    'portal.retention': 'Conservation', 'portal.send': 'Envoyer', 'portal.sendN': 'Envoyer {n} fichier | Envoyer {n} fichiers',
    'portal.serverType': 'Le fichier « {name} » n’est pas d’un type accepté.', 'portal.serverTooLarge': 'Le fichier « {name} » dépasse la taille maximale.', 'portal.serverTooMany': 'Trop de fichiers pour un seul dépôt (maximum {max}).',
    'portal.full': 'Ce portail ne peut pas recevoir un tel volume. Réduisez votre envoi ou communiquez avec le destinataire.', 'portal.rate': 'Trop de dépôts en peu de temps depuis votre connexion. Réessayez plus tard.',
    'portal.sending': 'Envoi en cours', 'portal.keepOpen': 'Ne fermez pas cette page tant que l’envoi n’est pas terminé.', 'portal.overall': 'Progression totale', 'portal.sentOf': '{sent} sur {total}',
    'portal.fileProgress': 'Envoi de {name}', 'portal.waiting': 'En attente', 'portal.sent': 'Envoyé', 'portal.fileError': 'Interrompu',
    'portal.failed': 'L’envoi a été interrompu', 'portal.failedText': 'La connexion a été perdue. Rien n’est perdu : l’envoi reprendra là où il s’est arrêté.', 'portal.resumeBtn': 'Reprendre l’envoi',
    'portal.closedMid': 'Le portail a été fermé pendant l’envoi', 'portal.closedMidText': 'Ce portail n’accepte plus de dépôts. L’envoi a été arrêté et vos fichiers n’ont pas été déposés. Communiquez avec la personne qui vous a transmis ce lien.',
    'portal.analysing': 'Analyse en cours…', 'portal.analysingText': 'Vos fichiers sont reçus. Ils sont vérifiés avant d’être remis au destinataire ; cela prend habituellement quelques secondes.',
    'portal.receipt': 'Dépôt reçu', 'portal.receiptPartial': 'Dépôt reçu en partie', 'portal.receiptNone': 'Aucun fichier n’a été accepté', 'portal.receiptNoneText': 'Votre dépôt n’a pas pu être remis au destinataire. Consultez le détail ci-dessous.',
    'portal.refLabel': 'Numéro de référence', 'portal.refHint': 'Conservez ce numéro : il identifie votre dépôt auprès du destinataire.', 'portal.copyRef': 'Copier le numéro', 'portal.date': 'Reçu le {date}',
    'portal.accepted': 'Accepté', 'portal.rejected': 'Refusé', 'portal.pending': 'En cours d’analyse', 'portal.summary': '{ok} accepté(s), {ko} refusé(s)', 'portal.another': 'Faire un autre dépôt',
    'portal.resume': 'Un dépôt est en cours', 'portal.resumeText': 'La page a été rechargée pendant l’envoi (référence {ref}). Resélectionnez les mêmes fichiers pour continuer là où l’envoi s’est arrêté.',
    'portal.resumeChoose': 'Resélectionner les fichiers', 'portal.resumeMissing': 'À resélectionner', 'portal.resumeFound': 'Prêt', 'portal.resumeGo': 'Continuer l’envoi', 'portal.resumeAbandon': 'Abandonner et recommencer',
    'portal.resumeMismatch': 'Ce fichier ne correspond à aucun fichier du dépôt en cours (même nom et même taille requis) : {name}',
    'reason.type_not_allowed': 'Ce type de fichier n’est pas accepté par ce portail.', 'reason.incomplete': 'Le fichier n’a pas été reçu en entier.', 'reason.executable': 'Le contenu est un programme ou un script, ce qui n’est jamais accepté.',
    'reason.type_mismatch': 'Le contenu ne correspond pas à l’extension du fichier.', 'reason.infected': 'L’antivirus a détecté une menace dans ce fichier.', 'reason.unscannable': 'Le fichier n’a pas pu être vérifié par l’antivirus.',
    'reason.target_unavailable': 'Le destinataire ne peut pas recevoir ce fichier pour le moment.', 'reason.quota_exceeded': 'Le destinataire ne peut pas recevoir ce fichier pour le moment.', 'reason.expired': 'Le dépôt n’a pas été terminé à temps.',
    'reason.other': 'Le fichier n’a pas pu être accepté.',
  },
  en: {
    language: 'Language', retry: 'Retry', optional: 'optional', password: 'Password',
    'err.network': 'Cannot connect. Check the network and try again.', 'err.tooMany': 'Too many attempts. Wait a few minutes before trying again.',
    'err.passwordInvalid': 'Wrong password.', 'err.passwordRequired': 'Enter the password.', 'err.generic': 'Something went wrong. Try again.',

    'share.title': 'Share',
    'share.unavailable': 'This link is not available', 'share.unavailableText': 'Check the address or ask the person who sent it for a new link.',
    'share.protected': 'This content is protected', 'share.protectedText': 'Enter the password you were given to access it.',
    'share.locked': 'Your access has expired', 'share.lockedText': 'For security, access is limited in time. Reopen the link to continue.', 'share.reopen': 'Reopen the link',
    'share.open': 'Open', 'share.sharedBy': 'Shared by {owner}', 'share.expires': 'Available until {date}', 'share.viewOnly': 'View only',
    'share.viewOnlyText': 'Downloading is not offered for this link.', 'share.preview': 'Preview', 'share.download': 'Download', 'share.downloadName': 'Download {name}',
    'share.downloadAll': 'Download all (ZIP)', 'share.downloading': 'Downloading… {pct}%',
    'share.downloadLimit': 'The download limit of this link has been reached. Ask the person who sent it for a new link.',
    'share.downloadForbidden': 'Downloading is not allowed for this link.', 'share.emptyZip': 'This folder has no file to download.',
    'share.emptyFolder': 'This folder is empty.', 'share.folderGone': 'This folder no longer exists. Back to the shared folder.', 'share.fileGone': 'This file is no longer available.',
    'share.breadcrumb': 'Location', 'share.viewList': 'List', 'share.viewGrid': 'Grid', 'share.openItem': 'Open {name}',
    'share.items': '{n} item | {n} items', 'share.modified': 'Modified {date}', 'share.dismiss': 'Dismiss message',

    'portal.title': 'File deposit', 'portal.unavailable': 'This deposit link is not available', 'portal.unavailableText': 'Check the address or ask the person who sent it for a new link.',
    'portal.closed': 'This portal no longer accepts deposits', 'portal.closedText': 'The deposit period is over or the portal has been paused. Contact the person who gave you this link.',
    'portal.instructions': 'Instructions', 'portal.rules': 'Before you deposit',
    'portal.typesAny': 'All file types, except programs and scripts', 'portal.types': 'Accepted types: {list}',
    'portal.maxSize': '{size} maximum per file', 'portal.maxFiles': '{n} file per deposit | Up to {n} files per deposit', 'portal.deadline': 'Deadline: {date}', 'portal.remaining': 'Space remaining: {size}',
    'portal.name': 'Your name', 'portal.email': 'Your email', 'portal.reference': 'Reference', 'portal.referenceHint': 'File number, order number or any useful reference.',
    'portal.passwordHint': 'This portal is protected: enter the password you were given.',
    'portal.required': 'This field is required.', 'portal.emailInvalid': 'Enter a valid email address.', 'portal.requiredLegend': 'Fields marked with an asterisk are required.',
    'portal.files': 'Your files', 'portal.drop': 'Drag your files here', 'portal.dropTouch': 'Add your files', 'portal.dropActive': 'Drop to add', 'portal.choose': 'Choose files', 'portal.addMore': 'Add more files', 'portal.photo': 'Take a photo',
    'portal.selected': '{n} file selected · {size} | {n} files selected · {size}', 'portal.remove': 'Remove {name}', 'portal.removeInvalid': 'Remove refused files',
    'portal.noFiles': 'Add at least one file.', 'portal.fixFiles': 'Remove the refused files to continue.',
    'portal.tooMany': 'This portal accepts at most {max} files per deposit; you selected {n}.', 'portal.overTotal': 'The selected total ({size}) exceeds the space still available on this portal ({max}).',
    'portal.fileType': 'File type not accepted (.{ext})', 'portal.fileTypeNone': 'File type not accepted (no extension)', 'portal.fileBlocked': 'Programs and scripts are never accepted (.{ext})',
    'portal.fileTooLarge': 'Too large: {size} (maximum {max})', 'portal.fileEmpty': 'Empty file',
    'portal.consentRequired': 'You must give your consent to send.', 'portal.consentDefault': 'I agree that the files and information provided are sent to the recipient.',
    'portal.retention': 'Retention', 'portal.send': 'Send', 'portal.sendN': 'Send {n} file | Send {n} files',
    'portal.serverType': 'The file “{name}” is not of an accepted type.', 'portal.serverTooLarge': 'The file “{name}” exceeds the maximum size.', 'portal.serverTooMany': 'Too many files for one deposit (maximum {max}).',
    'portal.full': 'This portal cannot receive that much data. Reduce your deposit or contact the recipient.', 'portal.rate': 'Too many deposits in a short time from your connection. Try again later.',
    'portal.sending': 'Sending', 'portal.keepOpen': 'Do not close this page until the transfer is complete.', 'portal.overall': 'Overall progress', 'portal.sentOf': '{sent} of {total}',
    'portal.fileProgress': 'Sending {name}', 'portal.waiting': 'Waiting', 'portal.sent': 'Sent', 'portal.fileError': 'Interrupted',
    'portal.failed': 'The transfer was interrupted', 'portal.failedText': 'The connection was lost. Nothing is lost: the transfer will resume where it stopped.', 'portal.resumeBtn': 'Resume the transfer',
    'portal.closedMid': 'The portal was closed during the transfer', 'portal.closedMidText': 'This portal no longer accepts deposits. The transfer was stopped and your files were not deposited. Contact the person who gave you this link.',
    'portal.analysing': 'Checking your files…', 'portal.analysingText': 'Your files have been received. They are checked before being handed to the recipient; this usually takes a few seconds.',
    'portal.receipt': 'Deposit received', 'portal.receiptPartial': 'Deposit partly received', 'portal.receiptNone': 'No file was accepted', 'portal.receiptNoneText': 'Your deposit could not be handed to the recipient. See the details below.',
    'portal.refLabel': 'Reference number', 'portal.refHint': 'Keep this number: it identifies your deposit to the recipient.', 'portal.copyRef': 'Copy the number', 'portal.date': 'Received {date}',
    'portal.accepted': 'Accepted', 'portal.rejected': 'Refused', 'portal.pending': 'Being checked', 'portal.summary': '{ok} accepted, {ko} refused', 'portal.another': 'Make another deposit',
    'portal.resume': 'A deposit is in progress', 'portal.resumeText': 'The page was reloaded during the transfer (reference {ref}). Select the same files again to continue where the transfer stopped.',
    'portal.resumeChoose': 'Select the files again', 'portal.resumeMissing': 'To select again', 'portal.resumeFound': 'Ready', 'portal.resumeGo': 'Continue the transfer', 'portal.resumeAbandon': 'Abandon and start over',
    'portal.resumeMismatch': 'This file matches no file of the deposit in progress (same name and size required): {name}',
    'reason.type_not_allowed': 'This file type is not accepted by this portal.', 'reason.incomplete': 'The file was not received in full.', 'reason.executable': 'The content is a program or a script, which is never accepted.',
    'reason.type_mismatch': 'The content does not match the file extension.', 'reason.infected': 'The antivirus detected a threat in this file.', 'reason.unscannable': 'The file could not be checked by the antivirus.',
    'reason.target_unavailable': 'The recipient cannot receive this file at the moment.', 'reason.quota_exceeded': 'The recipient cannot receive this file at the moment.', 'reason.expired': 'The deposit was not completed in time.',
    'reason.other': 'The file could not be accepted.',
  },
};
