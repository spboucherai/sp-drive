# SP Drive — architecture

État : décisions prises après l'audit du 2026-11-11. Ce qui est réellement construit et vérifié est suivi dans
[`progress.md`](progress.md) ; ce document décrit la cible V1 et les raisons des choix.

## 1. Ce que l'audit a établi

| Sujet | Constat vérifié le 2026-11-11 |
|---|---|
| DNS | `drive.spboucher.ai` → `51.161.112.61` (passerelle MacLustr Tunnel BHS64). Aucune route Caddy encore : le site ne répond pas. |
| Dépôt | Aucun dépôt `sp-drive` n'existait. Créé sur le portable pour l'amorçage ; après `mld stage` + `mld deploy`, la source de vérité devient le clone du nœud (règle « remote-first »). |
| Conventions SP | SP Wallet (`wallet.spboucher.ai`) : monorepo pnpm, Fastify 5 + `postgres` + zod, web Vite/React 19/Tailwind 4 servi par l'API, bundle esbuild `dist/`, PM2, PostgreSQL 17 Homebrew, sauvegarde nocturne `pg_dump`, déploiement `mld`, passkeys `@simplewebauthn`. SP Drive reprend ces conventions. SP Wallet n'est ni modifié ni appelé. |
| Nœud | **m5ma** (Mac mini M5 Pro, 15 cœurs, 24 Go, SSD interne 460 Go dont 375 Go libres, aucune app). Node 26 et pnpm présents ; PostgreSQL, ClamAV, LibreOffice et ffmpeg à installer. FileVault désactivé (ouverture de session automatique après coupure) → le chiffrement au repos est fait par l'application. |
| NAS | Non utilisé (décision du propriétaire : SSD d'un nœud). La couche de stockage reste abstraite. |
| Docker | Absent de m5ma, et la convention du cluster est PM2 + services Homebrew. Docker Compose n'est pas retenu pour la première mise en production. |
| Courriel | Aucune configuration d'envoi propre à SP Drive. Les notifications sont dans l'application ; l'envoi par courriel est conditionnel à une clé fournie par le propriétaire. |
| Contrainte macOS | Les processus PM2 ne peuvent pas ouvrir de connexions LAN (confidentialité « réseau local »). Tout SP Drive tourne donc sur un seul nœud, en `127.0.0.1` et sockets Unix. |

## 2. Écarts motivés par rapport à l'architecture « cible » du cahier des charges

| Cible proposée | Choix | Raison |
|---|---|---|
| Next.js | API Fastify + SPA Vite/React/TypeScript/Tailwind servie par l'API | Convention SP Wallet déjà éprouvée avec `mld` (un port, un processus, une origine). Une application derrière connexion ne gagne rien au rendu serveur ; les téléversements résumables et le flux chiffré avec `Range` demandent un contrôle direct des flux HTTP. |
| Redis (cache, files d'attente) | File de travaux PostgreSQL (`jobs`, `FOR UPDATE SKIP LOCKED`), limitation de débit en mémoire + compteurs en base | Une dépendance de moins à exploiter et à sauvegarder ; les travaux sont transactionnels avec les métadonnées (un fichier placé et son travail d'aperçu sont validés ensemble). Charge visée : quelques utilisateurs. |
| MinIO / S3 | Interface `BlobStore` + pilote système de fichiers sur le SSD du nœud | Un seul nœud, pas de LAN entre processus. Le chiffrement et l'adressage sont au-dessus du pilote : un pilote S3 pourra être ajouté sans toucher au reste. Non construit en V1. |
| URL signées | Aucune URL de stockage n'est exposée | Chaque lecture passe par l'API, qui contrôle l'autorisation puis déchiffre en flux. |
| Docker Compose | PM2 + Homebrew via `mld` | Convention du cluster ; reprise automatique après coupure déjà gérée par `mld heal`. |
| Microservices | Deux processus : `sp-drive` (API + web) et `sp-drive-worker` (antivirus, aperçus, portails, ménage) ; modules séparés dans le code | Le cahier des charges demande de ne pas créer de microservices superflus. |

## 3. Vue d'ensemble

```
Navigateur ──HTTPS──▶ Caddy (BHS64) ──WireGuard──▶ m5ma:8660  sp-drive (Fastify)
                                                     │  ├─ web statique (dist/web)
                                                     │  ├─ /api/v1/…        (session)
                                                     │  └─ /api/v1/public/… (liens, portails)
                                                     ▼
                                   PostgreSQL 17 (127.0.0.1)  ◀──▶  sp-drive-worker
                                                     │                 ├─ clamd (socket Unix)
                                   ~/sp-drive-data   │                 ├─ sips / LibreOffice / ffmpeg
                                     ├─ blobs/   (objets chiffrés)     │    sous sandbox-exec
                                     ├─ tmp/     (téléversements en cours)
                                     └─ quarantine/ (dépôts anonymes avant analyse)
```

Modules de l'API (`services/api/src`) : `auth` (passkeys, sessions, récupération, TOTP), `authz` (politiques
centralisées), `tree` (dossiers, fichiers, corbeille, versions), `uploads`, `content` (lecture, `Range`, ZIP),
`shares`, `requests` (portails), `previews`, `search`, `notify`, `audit`, `jobs`, `blob` + `crypto` (stockage).

## 4. Modèle de données

Tables : `users`, `quotas`, `passkeys`, `sessions`, `auth_challenges`, `recovery_codes`, `invites`, `folders`,
`files`, `file_versions`, `storage_objects`, `previews`, `uploads`, `tags`, `file_tags`, `shares`,
`share_access_events`, `upload_requests`, `upload_submissions`, `upload_items`, `audit_events`, `jobs`,
`notifications`. Migrations numérotées avec `up` et `down` (`services/api/src/migrations`).

Règles structurantes :

- Chaque utilisateur possède un dossier racine. Tout dossier et tout fichier porte `owner_id` ; chaque requête
  filtre sur le propriétaire de la session. Un identifiant deviné d'un autre utilisateur répond 404, pas 403.
- Unicité des noms : index uniques partiels `(dossier parent, nom normalisé)` sur les éléments vivants, pour les
  dossiers et pour les fichiers ; un fichier et un dossier ne peuvent pas porter le même nom au même endroit
  (contrôle sous verrou). Le nom normalisé est NFC + minuscules.
- Concurrence : toute modification de l'arbre d'un utilisateur prend un verrou consultatif PostgreSQL par
  propriétaire dans sa transaction. Les déplacements vérifient l'absence de cycle sous ce verrou.
- Collisions : le client choisit `fail` (409 avec le nom en conflit), `rename` (« nom (2).ext ») ou `version`
  (nouvelle version du fichier existant). Jamais d'écrasement silencieux.
- Corbeille : `trashed_at` + `trash_root` sur l'élément et ses descendants ; la restauration traite le groupe,
  renomme en cas de collision et retombe sur la racine si le parent a disparu.
- Versions : `file_versions` (numéro croissant) → `storage_objects`. Restaurer une version en crée une nouvelle.
- Objets : `storage_objects` est unique par `(owner_id, sha256, taille)`. La déduplication ne traverse jamais les
  utilisateurs : aucun téléversement n'est raccourci parce qu'un autre compte possède le même contenu.
- Quota : somme des tailles des objets du propriétaire, vérifiée sous verrou à la création d'un téléversement et
  à sa finalisation ; les dépôts des portails comptent dans le quota du propriétaire du portail.
- Suppression définitive : les lignes partent, puis un ramasse-miettes supprime les objets et aperçus orphelins.

## 5. Stockage et chiffrement

- Clé maîtresse de 32 octets dans un fichier hors dépôt (`~/.config/sp-drive/master.key`, mode 600), copie dans
  le dossier de secrets du propriétaire. Sans elle les fichiers sont illisibles : elle fait partie de la sauvegarde.
- Chaque objet a sa propre clé de données (aléatoire), enveloppée par la clé maîtresse (AES-256-GCM, octet de
  version). La rotation de la clé maîtresse ré-enveloppe les clés de données sans réécrire les fichiers
  (`cli rotate-master-key`).
- Contenu : AES-256-GCM par blocs de 64 Kio, nonce = index du bloc, données associées = taille totale + index +
  marqueur de dernier bloc (détecte troncature, réordonnancement et substitution). Lecture par plage possible :
  seuls les blocs demandés sont déchiffrés (vidéo, reprise de téléchargement).
- Les fichiers temporaires (téléversements en cours, quarantaine, conversions) sont en clair sur le même SSD,
  dans des dossiers en mode 700, et supprimés à la fin du traitement ou par le ménage périodique.
- Transport : TLS terminé par Caddy sur BHS64, puis WireGuard jusqu'au nœud.

## 6. Authentification

- Passkeys WebAuthn uniquement (pas de mot de passe de compte). Vérification utilisateur exigée ; aucune donnée
  biométrique ne quitte l'appareil. Plusieurs passkeys par compte, clés physiques acceptées.
- Création de compte par invitation à usage unique (la première est émise par la CLI sur le nœud).
- Sessions : jeton aléatoire, seul son hash est en base ; cookie `__Host-` HttpOnly, Secure, SameSite=Lax ;
  expiration absolue 30 jours, inactivité 14 jours, rotation quotidienne du jeton ; liste et révocation par appareil.
- Réauthentification (passkey, moins de 5 minutes) pour : ajouter ou retirer une passkey, régénérer les codes de
  récupération, gérer le TOTP, administrer les utilisateurs.
- Récupération : 10 codes à usage unique (hachés). Si le TOTP est activé, il est exigé avec le code. Une session
  de récupération ne sert qu'à enrôler une nouvelle passkey ; elle déclenche une notification et un événement d'audit.
- CSRF : toute requête modifiante exige l'en-tête `X-SPD-CSRF` et une origine identique ; pas de CORS.

## 7. Liens de partage et portails de dépôt

- Jetons de 256 bits, affichés une seule fois, stockés hachés (SHA-256). Mots de passe hachés avec scrypt.
- Lien de partage : cible fichier ou dossier ; lecture seule ou lecture + téléchargement ; expiration, nombre
  maximal de consultations et de téléchargements, usage unique, révocation immédiate, journal d'accès. Pour un
  dossier, chaque accès vérifie côté serveur que l'élément demandé est un descendant vivant du dossier partagé.
- Portail de dépôt : `/request/<jeton>`, indépendant d'un lien de partage. Le déposant ne reçoit qu'un jeton de
  soumission qui autorise uniquement l'envoi de ses propres fichiers et la lecture de l'état de sa soumission.
  Chaîne : quarantaine → signature/MIME → antivirus → placement atomique dans le dossier cible. Les politiques
  (actif, expiré, quotas) sont réévaluées à chaque bloc reçu et à la finalisation.
- Le dépôt par lien de partage n'existe pas : le dépôt passe toujours par un portail.

## 8. Aperçus

| Type | Méthode |
|---|---|
| PDF | pdf.js dans le navigateur (pages, zoom, recherche) |
| JPEG, PNG, WebP, GIF | affichage direct ; vignette par `sips` |
| HEIC | conversion JPEG par `sips` (worker) |
| SVG | `<img>` + réponse `Content-Security-Policy: sandbox` (aucun script ne s'exécute) |
| Vidéo, audio | lecteur natif avec `Range` ; pas de transcodage en V1 |
| Texte, Markdown, CSV, JSON, XML, code | rendu côté client, limite de taille ; Markdown assaini |
| DOCX, PPTX, ODT, ODP | LibreOffice sans interface → PDF, profil jetable, `sandbox-exec` sans réseau, délai maximal |
| XLSX | lecture par le worker → JSON par feuille, avec limites de lignes, colonnes et feuilles |
| ZIP, TAR, TAR.GZ | inventaire des entrées sans extraction, plafonds d'entrées et d'octets lus |
| Autres | message clair + téléchargement |

Les originaux ne sont jamais modifiés. Les aperçus dérivés sont chiffrés comme les objets.

## 9. Sécurité

Voir [`threat-model.md`](threat-model.md). En-têtes : CSP stricte sans script en ligne, `nosniff`,
`frame-ancestors 'none'`, `Referrer-Policy: no-referrer` sur les pages publiques. Les contenus des utilisateurs
sont servis avec `Content-Security-Policy: sandbox; default-src 'none'` et en pièce jointe sauf types sûrs.

## 10. Exploitation

Manifeste `mld` : `sp-drive`, `sp-drive-worker`, `sp-drive-clamd`, `sp-drive-freshclam`, `sp-drive-backup`
(nocturne). Santé : `/api/v1/health/live` et `/api/v1/health/ready`. Sauvegarde : `pg_dump` + copie incrémentale
des objets chiffrés ; restauration vérifiée par `scripts/restore-test.sh`. Voir `runbooks/operations.md`.

## 11. Hors V1

OCR, recherche plein texte et sémantique, résumés et Q&A ; pilote S3 ; transcodage vidéo ; synchronisation
Finder ou application iOS native ; partage entre comptes internes (espaces communs).
