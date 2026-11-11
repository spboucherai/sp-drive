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
