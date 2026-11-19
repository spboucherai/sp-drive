# SP Drive — état d'avancement

Dernière mise à jour : 2026-11-11. « Vérifié » signifie : commande exécutée, résultat observé. Production :
https://drive.spboucher.ai sur **m5ma** (PM2, déployé par `mld`, dépôt `sp-drive.git` sur spbgit).

## Vérifications exécutées

| Quoi | Commande | Résultat du 2026-11-11 |
|---|---|---|
| Types | `pnpm typecheck` | aucun message |
| Intégration (PostgreSQL réel, ClamAV réel, LibreOffice réel sur le portable) | `pnpm test` | 63 tests, 63 réussis |
| E2E bureau + mobile (Chromium, passkey virtuelle) + pages publiques sur WebKit iPhone | `pnpm e2e` | 122 réussis, 6 ignorés (captures d'écran) |
| Production | `scripts/prod-smoke.mts` sur drive.spboucher.ai | 21 contrôles réussis, 1 échec connu (conversion bureautique, voir « Bloqué ») |
| Sauvegarde + restauration sur le nœud | `scripts/backup.sh` puis `scripts/restore-test.sh` | `RESTORE TEST OK` (6 objets déchiffrés et re-hachés) |

## Terminé et vérifié

- **Comptes** : invitation à usage unique, passkeys (plusieurs, renommage, retrait sauf la dernière), sessions par
  appareil avec révocation, rotation quotidienne du jeton, réauthentification pour les opérations sensibles, codes de
  récupération, TOTP facultatif (exigé avec un code de récupération), administration (utilisateurs, quotas,
  invitations, état du système), journal d'activité.
- **Explorateur** : dossiers imbriqués, création, renommage, déplacement, copie, corbeille, restauration, suppression
  définitive ; téléversement multiple, par dossier, résumable, avec pause, reprise, annulation et SHA-256 ;
  collisions explicites (échec, renommer, nouvelle version) ; téléchargement direct avec reprise et ZIP ; versions ;
  quotas ; tags ; favoris ; récents ; recherche avec filtres ; doublons par compte ; grille et liste ; clavier ;
  glisser-déposer.
- **Aperçus** : PDF (pages, zoom, recherche), images, HEIC, SVG inerte, vidéo, audio, texte, Markdown assaini, CSV,
  JSON, classeurs XLSX, inventaire ZIP/TAR ; message clair pour le reste et pour les échecs.
- **Liens de partage** : fichier ou dossier, lecture seule ou téléchargement, mot de passe, expiration, plafonds de
  consultations et de téléchargements, usage unique, rotation, révocation immédiate, journal d'accès.
- **Portails de dépôt** : création illimitée, formulaire configurable, consentement, limites (taille, nombre, volume,
  fréquence, types), mot de passe, expiration, pause, rotation, révocation, suppression ; quarantaine → signature →
  antivirus → placement atomique ; reçu avec numéro de référence ; journal par dépôt ; notification au propriétaire.
- **Stockage** : objets et aperçus chiffrés (AES-256-GCM par blocs, clé par objet), lecture par plage, détection
  d'altération, ramasse-miettes.
- **Interface** : français et anglais, clair et sombre, bureau et téléphone, palette de commandes (⌘K), PWA
  installable (manifeste, icônes, service worker qui ne met en cache ni l'API ni les documents).
- **Exploitation** : manifeste `mld`, préparation du nœud, antivirus et mises à jour de signatures, sauvegarde
  nocturne chiffrée, test de restauration, CLI (invitation, réinitialisation d'accès, suppression de compte, rotation
  de clé, vérification des objets, migrations avec retour arrière).

## Bloqué

- **Aperçu des documents Word / PowerPoint / OpenDocument en production.** Sur m5ma, macOS suspend LibreOffice avant
  son démarrage tant que son premier lancement n'a pas été approuvé à l'écran (le nœud n'a pas d'opérateur devant
  lui). L'application le détecte en moins de 20 s et affiche « convertisseur indisponible » ; les fichiers restent
  téléchargeables. Pour débloquer : ouvrir une fois LibreOffice sur m5ma par partage d'écran et accepter
  l'avertissement, puis `pm2 restart sp-drive-worker`. La chaîne elle-même est vérifiée sur le portable (tests
  d'intégration et E2E).

## Construit, non vérifié sur l'environnement cible

- **Vrai Touch ID / Face ID** (Safari macOS et iOS) : tous les tests utilisent l'authentificateur virtuel de Chromium.
- **iPhone réel** : envoi depuis Photos/Fichiers, prise de photo, feuille de partage native, installation sur l'écran
  d'accueil ; les pages publiques passent sur WebKit émulé, pas sur un appareil.
- Appui long tactile, dépôt d'un dossier entier depuis le bureau, affichage d'un fichier infecté dans l'explorateur,
  comportement avec plusieurs milliers d'éléments, expiration de l'accès à un lien après une heure.
- **Tests de charge** : aucun.
- **Redémarrage du nœud** : `pm2 save` fait et `mld heal` couvre l'app, mais aucune coupure n'a été simulée.

## Non fait en V1 (décidé ou reporté)

- Notifications et accusés de réception **par courriel** (aucun service d'envoi configuré pour SP Drive) : les
  notifications sont dans l'application, le reçu du déposant est affiché à l'écran.
- **Copie hors nœud des sauvegardes** : `SPD_BACKUP_REMOTE` existe, mais un processus PM2 ne peut pas joindre le LAN
  sous macOS ; la destination et le mécanisme sont à décider. Aujourd'hui la sauvegarde est sur le même SSD que les
  données : elle protège d'une erreur logique, pas de la perte du disque.
- Dépôt par lien de partage (le dépôt passe par un portail), partage entre comptes internes, pilote S3, transcodage
  vidéo, synchronisation Finder / application iOS.
- Indicateur de position « 3 / 12 » dans la visionneuse ; panneau de téléversement visible hors de l'explorateur ;
  messages d'échec d'aperçu en anglais brut sous un titre traduit.
- Journaux d'accès de la passerelle : Caddy journalise les URL, donc les jetons des liens publics y figurent.
- CI : les suites se lancent à la main (`pnpm typecheck && pnpm test && pnpm e2e`), aucun pipeline automatique.
- Recherche plein texte, OCR, recherche sémantique, Q&A : après stabilisation de la V1.

## 2.0 « Next Generation » — branche `next` (2026-11-19, non déployée)

Contrat : `docs/next/ARCHITECTURE-NEXT.md` ; formes JSON exactes et écarts : `docs/next/API-NEXT.md`. Migration `003_next`
(additive, `down` testé). Suites : `scripts/ci.sh` (typecheck + vitest sur PostgreSQL réel, clamd réel, bac à sable réel).

Fait et testé (tests d'intégration `services/api/test/next-*.test.ts`) :

- `GET /meta`, en-tête `X-SPD-Client` enregistré sur les sessions d'appareil.
- Événements de synchronisation `GET /sync/events` (SSE, `pg_notify`, regroupement, ping, fermeture à la révocation).
- Index de contenu : job `extract_text` après analyse antivirus propre ; texte, XML bureautique (docx, pptx, xlsx, odt,
  odp, ods), couche texte des PDF, OCR (images et pages PDF sans texte) par l'assistant local `infra/textkit`
  (PDFKit + Vision, compilé sur le nœud, exécuté dans le bac à sable) ; `cli reindex` ; recherche `in=` + extraits ;
  `/files/:id/text`, `/index/status`.
- Recherche sémantique `GET /search/semantic` (modèle embarqué `NLContextualEmbedding`, vecteurs `real[]`, score en Node).
- Couche IA `services/api/src/ai/` : `maclustr`, `anthropic` (SDK officiel), `openai`, `openrouter` ; `/ai/providers`,
  `/ai/ask` (SSE, RAG, citations), `/ai/suggest`. **Testée contre de faux serveurs uniquement : aucun fournisseur réel
  n'a été appelé** (aucune clé disponible).
- Collections (règle → SQL paramétré depuis une liste blanche), activité, vue du stockage, historique des
  téléversements, versions, doublons exacts et images similaires (dHash).
- Partage privé et espaces de travail : `folder_grants`, routes du propriétaire, famille `/shared/:grantId/…`.
- Administration : battement du worker, file de jobs, échecs d'aperçu, convertisseur, signatures antivirus, état des
  sauvegardes ; `scripts/backup.sh` écrit `status.json` + `manifest.tsv`, `scripts/backup-verify.sh`,
  `scripts/restore-test.sh` écrit `restore-test.json`.

Mesure de la recherche sémantique (`pnpm exec tsx scripts/semantic-eval.mts`, 24 passages FR/EN, 28 questions
reformulées, m5ma, 2026-11-19) :

| moteur local | même langue FR | même langue EN | inter-langues | tout |
|---|---|---|---|---|
| `NLContextualEmbedding` (moyenne des jetons, 512 d) | rappel@1 0,67 · @3 0,75 | rappel@1 0,67 · @3 0,92 | 0,00 | rappel@1 0,57 · @3 0,71 · MRR 0,67 |
| `NLEmbedding.sentenceEmbedding` | 0,00 (pas de modèle français) | rappel@1 0,33 · @3 0,58 | 0,00 | rappel@1 0,14 |

Hasard : rappel@1 0,04. Limites constatées : aucune capacité inter-langues ; les cosinus ne séparent pas le pertinent
du hors-sujet (meilleur cosinus 0,73–0,92 pour une vraie question, 0,66–0,86 pour une question sans rapport), donc le
score n'est jamais un seuil et l'IA ne s'appuie sur ce moteur que pour reclasser un résultat lexical.
`https://llm.spboucher.ai/v1/embeddings` n'existe pas (404 ; `/v1/chat/completions` répond 401).

Non fait dans cette branche : copie hors nœud elle-même (seulement le fichier d'état et le script de vérification) ;
recherche et événements à travers les dossiers partagés (voir écarts D8, D9) ; interface web et clients natifs.
