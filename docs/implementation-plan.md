# SP Drive — plan d'implémentation

Chaque jalon est une tranche verticale : schéma, API, interface, tests. Un jalon n'est « terminé » que si ses
critères sont vérifiés par des commandes exécutées (voir `progress.md`).

| # | Jalon | Contenu | Critère de vérification |
|---|---|---|---|
| 0 | Audit | Inventaire infra, conventions SP, choix d'architecture | `architecture.md`, ce plan |
| 1 | Fondations | Monorepo, migrations up/down, stockage chiffré, passkeys, sessions, récupération, TOTP, invitations, politiques d'accès, audit | Tests d'intégration sur PostgreSQL réel ; migration `down` puis `up` |
| 2 | Fichiers | Dossiers, téléversement résumable vérifié SHA-256, téléchargement `Range`, ZIP, versions, corbeille, quotas, tags, favoris, récents, recherche, doublons | Tests de concurrence, de reprise, de collision, d'IDOR |
| 3 | Aperçus | Worker, file de travaux, antivirus, vignettes, HEIC, bureautique, classeurs, archives | Tests avec fichiers réels, EICAR, bombe ZIP, échec de conversion |
| 4 | Partage et portails | Liens (expiration, mot de passe, compteurs, usage unique, révocation, journal), portails de dépôt complets | Tests adversariaux : révocation instantanée, expiration pendant transfert, déposant sans lecture |
| 5 | Interface | Explorateur, aperçus, partage, portails, réglages, pages publiques, FR/EN, clair/sombre, clavier, PWA | Playwright bureau et mobile |
| 6 | Production | Préparation de m5ma, manifeste `mld`, sauvegarde, test de restauration, runbook | Santé publique, restauration rejouée |
| 7 | Après V1 | OCR, plein texte, recherche sémantique, Q&A | Non commencé |

## Risques

| Risque | Parade |
|---|---|
| Perte de la clé maîtresse = perte de tous les fichiers | Copie hors nœud à la création, vérifiée par le test de restauration |
| Un seul nœud, un seul SSD | Sauvegarde nocturne vers un autre nœud ; la réplication hors site reste à décider par le propriétaire |
| Dépôts anonymes : abus de disque et de CPU | Tailles déclarées et plafonnées avant envoi, quotas par portail, limites par adresse, quarantaine, ménage |
| Conversion de documents hostiles | Processus séparé, `sandbox-exec` sans réseau, profil jetable, délais, plafonds de taille |
| Signatures antivirus périmées ou `clamd` arrêté | Les dépôts des portails restent en quarantaine (échec fermé) ; alerte dans l'état du système |
| Passkey perdue | Plusieurs passkeys + codes de récupération ; CLI d'invitation de secours sur le nœud |
| Dérive portable / nœud | Après le premier déploiement, toute modification se fait sur le nœud puis `git push` |

## Dépendances externes

PostgreSQL 17, ClamAV, LibreOffice, ffmpeg (Homebrew sur m5ma) ; `sips` et `sandbox-exec` (macOS) ; passerelle
MacLustr Tunnel (Caddy sur BHS64).
