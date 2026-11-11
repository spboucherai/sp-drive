# SP Drive — cahier des charges du propriétaire (2026-11-11)

Résumé fidèle du mandat reçu ; les décisions qui en découlent sont dans `architecture.md`.

**Mission.** Plateforme de stockage documentaire self-hosted de qualité production sur https://drive.spboucher.ai,
intégrée à MacLustr. Code réel, tests et procédures opérationnelles : aucune simulation présentée comme fonctionnelle.

**Principes.** Inspecter avant d'agir ; ne pas modifier SP Wallet ni un autre service ; jalons vérifiables ; tout est
persisté réellement (pas de mock, de faux liens, de faux statuts, de boutons inertes) ; sécurité par défaut, moindre
privilège, secrets hors dépôt, migrations réversibles, sauvegardes testées ; documenter ce qui n'est pas fini.

**Expérience.** Interface premium, rapide, accessible, en français par défaut avec i18n ; responsive bureau, tablette,
téléphone ; clair/sombre ; clavier ; commandes rapides ; grille/liste ; glisser-déposer ; états vides et d'erreur
explicites ; PWA installable, envoi depuis Photos/Fichiers sur iOS, prise de photo, partage natif si disponible. Ne pas
promettre de synchronisation Finder/iOS native.

**V1.** Explorateur (dossiers imbriqués, création, renommage, déplacement, copie, suppression, restauration, corbeille ;
envoi multiple et par dossier, résumable, progression, reprise, annulation, SHA-256 ; téléchargement direct ou ZIP,
recherche, filtres, tri, tags, favoris, récents, sélection, actions groupées ; versions, quotas, doublons sans fuite
entre utilisateurs ; collisions de noms et concurrence explicites). Aperçus (PDF avec pages/zoom/recherche, images dont
HEIC, SVG assaini, vidéo/audio, texte/Markdown/CSV/JSON/XML/code, DOCX/XLSX/PPTX par convertisseur isolé, inventaire
ZIP/TAR sans extraction, message clair pour le reste ; conversions en bac à sable avec limites). Liens de partage
(fichiers et dossiers ; lecture, téléchargement ; expiration, mot de passe haché, compteurs, révocation immédiate,
journal, usage unique ; jetons hachés ; contrôle serveur partout). **Portails de dépôt — priorité majeure**
(`/request/<token>`, nombre arbitraire, dossier cible, consignes, branding, confirmation ; sans compte ; mot de passe,
expiration, quotas, tailles, nombre de fichiers, types, fréquence ; champs nom/courriel/référence/personnalisés,
consentement ; identifiant et journal par soumission ; quarantaine, antivirus, signature, placement atomique ;
notifications ; le déposant ne peut rien lister, lire, remplacer ni supprimer ; désactivation, révocation, rotation,
suppression ; politiques appliquées aux envois déjà commencés ; protection contre abus). Comptes (passkeys WebAuthn,
Touch ID / Face ID, aucune donnée biométrique ; plusieurs passkeys, révocation, sessions/appareils, cookies durcis,
rotation, réauthentification ; codes de récupération ; TOTP optionnel ; clés physiques ; audit).

**Définition de terminé.** Données réelles persistant au redémarrage ; tests unitaires, d'intégration et E2E ;
permissions testées pour autorisés, non autorisés et anonymes ; erreurs, limites, journaux et sécurité traités ;
documenté et validé sur l'environnement cible.

**Après V1.** OCR, plein texte, recherche sémantique, résumés, Q&A avec citations, dans le respect des permissions.
