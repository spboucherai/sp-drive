import type { Dict } from '../i18n.ts';

export const common: Dict = {
  fr: {
    appName: 'SP Drive', cancel: 'Annuler', close: 'Fermer', save: 'Enregistrer', delete: 'Supprimer', confirm: 'Confirmer', copy: 'Copier', copied: 'Copié', retry: 'Réessayer', back: 'Retour',
    loading: 'Chargement…', yes: 'Oui', no: 'Non', ok: 'OK', create: 'Créer', edit: 'Modifier', download: 'Télécharger', open: 'Ouvrir', search: 'Rechercher', more: 'Plus d’actions', none: 'Aucun',
    'error.unknown': 'Une erreur est survenue.', 'error.network': 'Connexion impossible. Vérifiez le réseau et réessayez.', 'error.internal': 'Erreur du serveur. Réessayez dans un instant.',
    'error.unauthenticated': 'Votre session a expiré. Reconnectez-vous.', 'error.rate_limited': 'Trop de requêtes. Patientez un instant.', 'error.not_found': 'Élément introuvable.',
    'error.name_conflict': 'Un élément porte déjà ce nom à cet endroit.', 'error.quota_exceeded': 'Espace de stockage insuffisant.', 'error.file_too_large': 'Fichier trop volumineux.',
    'error.move_into_self': 'Un dossier ne peut pas être déplacé dans lui-même.', 'error.reauth_required': 'Confirmez avec votre passkey pour continuer.', 'error.infected': 'Ce fichier a été signalé par l’antivirus.',
    'error.checksum_mismatch': 'Le fichier reçu diffère du fichier envoyé. Réessayez.', 'error.upload_closed': 'Ce téléversement n’est plus actif.', 'error.too_many_items': 'Trop d’éléments pour une seule opération.',
    'error.invalid_request': 'Requête invalide.', 'error.last_passkey': 'La dernière passkey ne peut pas être retirée.', 'error.authentication_failed': 'Passkey refusée.', 'error.registration_failed': 'L’enregistrement de la passkey a échoué.',
    'error.challenge_expired': 'La demande a expiré. Réessayez.', 'error.invite_invalid': 'Cette invitation est invalide ou expirée.', 'error.recovery_failed': 'Courriel, code de récupération ou code de vérification refusé.',
    'error.recovery_locked': 'Trop de tentatives. Réessayez plus tard.', 'error.totp_invalid': 'Code refusé.', 'error.email_taken': 'Un compte utilise déjà cette adresse.', 'error.self_lockout': 'Vous ne pouvez pas désactiver ou rétrograder votre propre compte.',
    'error.bad_expiry': 'La date d’expiration doit être dans le futur.', 'error.current_version': 'La version courante ne peut pas être supprimée.', 'error.preview_failed': 'L’aperçu n’a pas pu être produit.',
    'error.preview_unsupported': 'Aucun aperçu pour ce format.', 'error.empty_selection': 'Rien à télécharger.', 'error.recovery_session': 'Cette session de récupération sert uniquement à enregistrer une nouvelle passkey.',
  },
  en: {
    appName: 'SP Drive', cancel: 'Cancel', close: 'Close', save: 'Save', delete: 'Delete', confirm: 'Confirm', copy: 'Copy', copied: 'Copied', retry: 'Retry', back: 'Back',
    loading: 'Loading…', yes: 'Yes', no: 'No', ok: 'OK', create: 'Create', edit: 'Edit', download: 'Download', open: 'Open', search: 'Search', more: 'More actions', none: 'None',
    'error.unknown': 'Something went wrong.', 'error.network': 'Cannot connect. Check the network and try again.', 'error.internal': 'Server error. Try again in a moment.',
    'error.unauthenticated': 'Your session expired. Sign in again.', 'error.rate_limited': 'Too many requests. Wait a moment.', 'error.not_found': 'Item not found.',
    'error.name_conflict': 'An item with this name already exists here.', 'error.quota_exceeded': 'Not enough storage space.', 'error.file_too_large': 'File too large.',
    'error.move_into_self': 'A folder cannot be moved into itself.', 'error.reauth_required': 'Confirm with your passkey to continue.', 'error.infected': 'This file was flagged by the antivirus.',
    'error.checksum_mismatch': 'The file received differs from the file sent. Try again.', 'error.upload_closed': 'This upload is no longer active.', 'error.too_many_items': 'Too many items for one operation.',
    'error.invalid_request': 'Invalid request.', 'error.last_passkey': 'The last passkey cannot be removed.', 'error.authentication_failed': 'Passkey not accepted.', 'error.registration_failed': 'Passkey registration failed.',
    'error.challenge_expired': 'The request expired. Try again.', 'error.invite_invalid': 'This invitation is invalid or expired.', 'error.recovery_failed': 'Email, recovery code or verification code not accepted.',
    'error.recovery_locked': 'Too many attempts. Try again later.', 'error.totp_invalid': 'Code not accepted.', 'error.email_taken': 'An account already uses this address.', 'error.self_lockout': 'You cannot disable or demote your own account.',
    'error.bad_expiry': 'The expiry must be in the future.', 'error.current_version': 'The current version cannot be deleted.', 'error.preview_failed': 'The preview could not be produced.',
    'error.preview_unsupported': 'No preview for this format.', 'error.empty_selection': 'Nothing to download.', 'error.recovery_session': 'This recovery session can only enrol a new passkey.',
  },
};
