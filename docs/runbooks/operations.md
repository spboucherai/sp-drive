# SP Drive — exploitation

Nœud : **m5ma** (épinglé). Répertoire : `~/apps/sp-drive` (clone git, source de vérité). Données : `~/sp-drive-data`.
Clé maîtresse : `~/.config/sp-drive/master.key`. Sauvegardes : `~/backups/sp-drive`. Sur le nœud, toujours
`export PATH=/opt/homebrew/bin:$PATH` (les sessions ssh non interactives n'ont pas `pm2`).

## Processus PM2

| Nom | Rôle |
|---|---|
| `sp-drive` | API + web, port 8660 |
| `sp-drive-worker` | antivirus, aperçus, portails, ménage |
| `sp-drive-clamd` | démon ClamAV (socket `~/sp-drive-data/run/clamd.sock`) |
| `sp-drive-freshclam` | mise à jour des signatures toutes les 6 h |
| `sp-drive-backup` | sauvegarde nocturne à 03 h 40 |

Variables à passer aux commandes manuelles (elles sont dans l'environnement PM2, pas dans le shell) :

```
cd ~/apps/sp-drive
export DATABASE_URL=postgres://127.0.0.1/sp_drive SPD_ORIGIN=https://drive.spboucher.ai SPD_RP_ID=drive.spboucher.ai
```

## Santé

- `curl -s localhost:8660/api/v1/health/ready` → `{ok, db, storage, antivirus}` ; 503 si l'un manque.
- Dans l'application : Administration → État du système (espace disque, file de travaux, travaux en échec).
- Journaux : `pm2 logs sp-drive --lines 100` (JSON ; les jetons des URL publiques y sont remplacés par `[redacted]`).

## Mettre à jour

```
cd ~/apps/sp-drive && git pull && pnpm install --frozen-lockfile && pnpm build
pm2 restart sp-drive sp-drive-worker        # redémarrer l'API seulement après la fin du build web
git push                                     # si la modification a été faite sur le nœud
```

Les migrations s'appliquent au démarrage. Avant une version qui en contient : `zsh scripts/backup.sh`.
Retour arrière : `git checkout <commit précédent> && pnpm build && pm2 restart …` ; si une migration doit être
annulée : `node dist/cli.mjs migrate-down --yes-drop-data` **après sauvegarde** (elle supprime les tables de la
migration ; pour `001_init` cela signifie tout).

## Comptes

- Première invitation ou invitation de secours : `node dist/cli.mjs invite --email <adresse> --admin` → lien à usage unique (72 h).
- Propriétaire sans passkey ni code de récupération : `node dist/cli.mjs reset-access --email <adresse>` → un code de
  récupération ; ses sessions sont révoquées et le TOTP retiré. À n'utiliser qu'après vérification de l'identité.

## Sauvegarde et restauration

`scripts/backup.sh` : copie incrémentale des objets chiffrés, puis dump PostgreSQL chiffré avec la clé maîtresse
(30 derniers conservés). `SPD_BACKUP_REMOTE=hôte:chemin` ajoute une copie par rsync.

**La clé maîtresse n'est pas dans la sauvegarde.** Sans elle, ni les objets ni les dumps ne sont lisibles. Copies à
tenir : dossier de secrets du propriétaire + un support hors ligne.

Test de restauration (ne touche pas la production) : `zsh scripts/restore-test.sh` → restaure le dernier dump dans
une base temporaire, déchiffre et re-hache chaque objet, affiche `RESTORE TEST OK`.

Restauration réelle sur un nœud neuf :

1. `mld prepare <nœud>` ; installer `postgresql@17 clamav ffmpeg` et LibreOffice.
2. Recopier `~/backups/sp-drive` et la clé maîtresse (`~/.config/sp-drive/master.key`, mode 600).
3. `createdb sp_drive` ; `openssl enc -d -aes-256-ctr -pbkdf2 -iter 200000 -pass file:$HOME/.config/sp-drive/master.key -in <dump> | pg_restore --no-owner -d sp_drive`.
4. `rsync -a ~/backups/sp-drive/blobs/ ~/sp-drive-data/blobs/`.
5. Déployer l'application (`mld deploy sp-drive --node <nœud>` après avoir changé `placement.pin`), puis `node dist/cli.mjs verify --deep`.

## Antivirus

- État : `pm2 logs sp-drive-clamd --lines 20` ; signatures : `ls -l ~/sp-drive-data/clamav-db`.
- Si `clamd` est arrêté, les dépôts des portails restent en quarantaine (statut « analyse en cours ») et sont repris
  automatiquement à son retour ; les fichiers du propriétaire restent « en attente d'analyse ».

## Rotation de la clé maîtresse

`node dist/cli.mjs rotate-master-key` (ré-enveloppe les clés de données, les fichiers ne sont pas réécrits), puis
`pm2 restart sp-drive sp-drive-worker`, puis **sauvegarder la nouvelle clé** et refaire `scripts/backup.sh`. Les dumps
antérieurs restent chiffrés avec l'ancienne clé (`master.key.previous`) : la conserver tant qu'ils existent.

## Ne pas faire

- `mld move sp-drive` : les données et la clé ne suivent pas.
- Supprimer `~/sp-drive-data/blobs` ou la clé maîtresse.
- Modifier une copie de l'application ailleurs que sur le nœud.

## 2.0 — ce qui change pour l'exploitation

- **Après la mise à niveau** : `scripts/textkit-build.sh` (compile `dist/spd-textkit`, ~30 s, Command Line Tools
  suffisants ; le crochet `post_sync` du manifeste le fait), puis `node dist/cli.mjs reindex` pour indexer l'existant
  (le worker traite en arrière-plan ; suivi : `GET /api/v1/index/status` ou la vue d'administration).
- **Index de contenu** : le texte extrait est en clair dans PostgreSQL (`object_passages`). Pour s'en passer :
  `SPD_INDEX_CONTENT=off` sur l'API **et** le worker, puis `node dist/cli.mjs purge-index --yes`. `SPD_OCR=off` coupe
  seulement l'OCR, `SPD_SEMANTIC=off` seulement les vecteurs.
- **IA** : rien n'est actif sans configuration. Clés dans `~/.config/sp-drive/ai.env` (mode 600), voir
  `docs/next/API-NEXT.md` §5.4. Les fournisseurs externes exigent `SPD_AI_EXTERNAL=on` et l'accord du compte.
- **Sauvegardes** : `scripts/backup.sh` écrit `status.json` et `manifest.tsv` ; `scripts/backup-verify.sh` vérifie le
  dernier dump et un échantillon d'objets (quelques secondes) ; sur une copie hors nœud :
  `scripts/backup-verify.sh <copie> --no-key --write offnode.json --label <nœud>` puis recopier `offnode.json` dans
  `~/backups/sp-drive/`. La vue d'administration affiche les quatre états.
- **Événements (SSE)** : `GET /api/v1/sync/events` reste ouvert ; Caddy transmet les flux `text/event-stream` sans
  tampon, rien à configurer. Une connexion PostgreSQL de plus par processus API (LISTEN).
- **CI** : `scripts/ci.sh` sur le nœud (`SPD_TEST_DB` / `SPD_TEST_ROOT` pour une base de test à part).

### LibreOffice bloqué sur m5ma (constat du 2026-11-19)

`/Applications/LibreOffice.app/Contents/MacOS/soffice` ne démarre plus, ni dans le bac à sable, ni hors du bac à sable,
ni depuis PM2 : le processus reste figé dans `_dyld_start` (avant sa première instruction). Journal système :
`syspolicyd … GK process assessment … waiting on another evaluation: PST: (path: 90260b28e44ff40b), (team: 7P5S3ZLCN7)`.
Gatekeeper a une évaluation de **premier lancement** en attente pour ce chemin (application installée par Homebrew Cask
avec l'attribut de quarantaine `0081`, jamais approuvée à l'écran ; l'attribut a été retiré de la plupart des fichiers
mais l'évaluation en cours ne se termine pas), et tout nouvel `exec` de ce chemin attend derrière elle. Ce n'est ni le
profil du bac à sable ni PM2. Preuve : une copie identique à un autre chemin
(`ditto /Applications/LibreOffice.app /Users/Shared/sp-drive-tools/LibreOffice.app`) démarre en 0,2 s et convertit dans
le bac à sable (suite `previews.test.ts` verte avec `SPD_SOFFICE` pointé dessus).

Correctif sans action à l'écran ni affaiblissement du bac à sable : ajouter au manifeste (API et worker)
`SPD_SOFFICE=/Users/Shared/sp-drive-tools/LibreOffice.app/Contents/MacOS/soffice` (la copie existe déjà, hors du
dossier personnel, donc lisible dans le bac à sable). Autres voies : approuver LibreOffice une fois à l'écran, ou
redémarrer le Mac (l'évaluation en attente disparaît) après `xattr -rs -d com.apple.quarantine /Applications/LibreOffice.app`.
