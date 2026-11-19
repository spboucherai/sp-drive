# SP Drive — modèle de menaces

Portée : l'application telle que déployée sur un nœud MacLustr derrière la passerelle (Caddy + WireGuard). Chaque
ligne renvoie au test qui prouve la défense (`services/api/test/…`) ou la marque « non testé ».

## Actifs

Contenu des fichiers ; métadonnées (noms, arborescence, déposants) ; clé maîtresse ; sessions ; jetons de liens et de
portails ; disponibilité (disque, CPU du nœud).

## Acteurs

| Acteur | Capacités |
|---|---|
| Anonyme sur Internet | Atteint toutes les routes publiques, peut deviner des jetons, envoyer des fichiers à un portail dont il a le lien |
| Détenteur d'un lien de partage | Lit ce que le lien couvre, tant qu'il est valide |
| Déposant d'un portail | Envoie des fichiers ; aucun droit de lecture |
| Utilisateur authentifié | Tout sur son propre espace ; rien sur celui des autres |
| Fichier hostile | Contenu conçu pour attaquer un convertisseur, l'antivirus, le navigateur d'un lecteur |
| Attaquant ayant une copie du disque ou d'une sauvegarde | Lit les fichiers bruts du nœud |

Hors portée : un attaquant root sur le nœud en fonctionnement (il a la clé maîtresse en mémoire) ; la compromission
de la passerelle TLS ; le poste du propriétaire.

## Menaces et parades

| # | Menace | Parade | Preuve |
|---|---|---|---|
| 1 | IDOR : lire ou modifier l'élément d'un autre compte par son identifiant | Chaque requête filtre par `owner_id` de la session ; 404 indistinct | `files.test` « isolation between accounts » (32 routes × compte tiers × anonyme) |
| 2 | Sortir d'un dossier partagé (identifiant d'un parent, d'un fichier voisin, ZIP) | Vérification serveur « descendant vivant du dossier partagé » à chaque accès | `shares.test` « confines a folder link » |
| 3 | Lien révoqué ou expiré encore utilisable | Le partage est relu en base à chaque requête ; le cookie d'accès ne remplace jamais ce contrôle | `shares.test` « revocation is immediate », « expires » |
| 4 | Dépassement des compteurs par requêtes simultanées | Incrément et test de limite dans une seule instruction SQL | `shares.test` « counts views and downloads atomically » |
| 5 | Deviner un jeton ou un mot de passe de lien | Jetons 256 bits hachés ; scrypt ; verrou après 20 échecs / 15 min par lien ; limite par adresse | `shares.test`, `requests.test` « stops guessing » |
| 6 | Fuite de jetons par les journaux ou le Referer | URL publiques expurgées avant journalisation ; `Referrer-Policy: no-referrer` ; aucun jeton en base | `shares.test` « stores only a hash », « does not log tokens » |
| 7 | Déposant qui liste, lit, remplace ou supprime | Jeton de soumission limité à ses propres envois et à son état ; placement par renommage, jamais par écrasement | `requests.test` « a depositor can never… » |
| 8 | Fichier malveillant déposé | Quarantaine → signature → ClamAV → placement ; exécutables et scripts toujours refusés ; échec fermé si l'antivirus est arrêté | `requests.test` « quarantines, scans… », « keeps deposits in quarantine… » |
| 9 | Portail utilisé après expiration, pause ou révocation, y compris transfert en cours | Politique réévaluée à chaque bloc et à la finalisation | `requests.test` « applies expiry, pause and revocation… » |
| 10 | Saturation du disque par dépôts anonymes | Tailles déclarées et réservées à l'admission ; plafonds par fichier, par dépôt, par portail, par heure et par adresse ; quota du propriétaire ; ménage des dépôts abandonnés | `requests.test` « enforces every limit », « rotates, deletes and cleans up » |
| 11 | Noms de fichiers dangereux (traversée, caractères de contrôle, noms réservés, RTL) | `sanitizeName` unique ; les noms ne deviennent jamais des chemins disque (objets adressés par UUID) | `names.test`, `requests.test` « neutralises dangerous file names » |
| 12 | XSS par contenu de fichier (SVG, HTML, Markdown) | Tout contenu utilisateur servi avec `Content-Security-Policy: sandbox`, `nosniff`, pièce jointe hors types sûrs ; SVG en `<img>` ; Markdown assaini | En-têtes : `files.test` ; exécution dans le navigateur : `tests/e2e/preview.spec.ts` |
| 13 | CSRF | SameSite=Lax + en-tête `X-SPD-CSRF` obligatoire + contrôle d'origine ; aucun CORS | `auth.test` « requires the CSRF header and origin » |
| 14 | Vol ou rejeu de session | Jeton haché en base, cookie `__Host-` HttpOnly Secure, rotation quotidienne, révocation par appareil | `auth.test` « rotates the session token », « lists and revokes sessions » |
| 15 | Hameçonnage de passkey, rejeu de défi | Origine et RP ID vérifiés ; défis à usage unique | `auth.test` « refuses a forged origin, a replayed challenge… » |
| 16 | Prise de contrôle par la récupération | Codes à usage unique, TOTP exigé si activé, verrou par compte, session limitée à l'enrôlement, notification | `auth.test` (4 tests de récupération) |
| 17 | Convertisseur compromis par un document | `sandbox-exec` : pas de réseau, pas d'accès au dossier personnel, à la clé, aux objets ni au socket PostgreSQL ; écriture limitée au dossier du travail ; délai et limite CPU | `previews.test` « runs converters without network… » |
| 18 | Bombe de décompression | Contrôle du répertoire central avant ouverture ; inventaire sans extraction avec plafonds | `previews.test` « refuses archive bombs » |
| 19 | SSRF | Le serveur n'effectue aucune requête vers une adresse fournie par un utilisateur ; convertisseurs sans réseau | Par construction + test 17 |
| 20 | Injection SQL | Requêtes paramétrées uniquement ; motifs `LIKE` échappés | `files.test` « searches… » |
| 21 | Vol du disque ou d'une sauvegarde | Objets et aperçus chiffrés (AES-256-GCM par blocs), dump chiffré ; clé maîtresse hors sauvegarde | `files.test` « never writes plaintext », `previews.test` |
| 22 | Altération d'un objet stocké | Authentification par bloc liée à la position et à la taille | `files.test` « detects tampering » |
| 23 | Déduplication comme canal d'information entre comptes | Déduplication limitée au propriétaire | `files.test` « deduplicates within the account only » |

## Risques résiduels acceptés ou à traiter

- **Fichiers temporaires en clair** (téléversements en cours, quarantaine, conversions) sur le SSD du nœud, FileVault
  désactivé pour le redémarrage automatique : fenêtre courte, dossiers en mode 700. Accepté pour la V1.
- **Lien en lecture seule** : empêche le téléchargement de l'original, pas la copie de ce qui est affiché.
- **Limite mémoire des convertisseurs** : macOS n'offre pas de plafond RAM fiable par processus ; parade partielle par
  tailles maximales, délai, limite CPU et redémarrage PM2 du worker.
- **Un seul nœud** : la panne du SSD interrompt le service jusqu'à restauration ; la copie hors nœud est configurable
  (`SPD_BACKUP_REMOTE`) mais la destination est une décision du propriétaire.
- **Journaux d'accès de la passerelle** (Caddy sur BHS64) : hors de ce dépôt ; s'ils sont activés, ils contiennent les
  URL publiques avec jeton. À vérifier côté passerelle.
- **Fichiers > 4 000 Mo** du propriétaire : non analysés par l'antivirus (marqués comme tels).

## 2.0 — surfaces ajoutées

- **Texte extrait en clair dans PostgreSQL** (`object_passages`, vecteurs compris) : les objets restent scellés, mais
  une copie de la base révèle désormais le texte des documents indexés. Compromis assumé pour la recherche ; le dump de
  sauvegarde est scellé avec la clé maîtresse ; interrupteur `SPD_INDEX_CONTENT=off` + `cli purge-index`. Seuls les
  contenus déclarés sains par l'antivirus sont indexés ; un contenu déclaré infecté perd son index.
- **Assistant local `spd-textkit`** (PDFKit, Vision, NaturalLanguage) : exécuté dans le même profil `sandbox-exec`
  que les autres convertisseurs (pas de réseau, pas d'accès au dossier personnel ni aux données), avec deux exceptions
  réservées à ce binaire : lecture-écriture de `~/Library/Caches/spd-textkit` (cache de modèles compilés par macOS, nommé
  d'après le processus) et lecture de `~/Library/Daemon Containers/*/Data/CompiledModels/`. Sans elles Vision échoue.
  Ces chemins ne contiennent aucune donnée d'utilisateur. Test : l'assistant ne peut lire ni la clé, ni les objets, ni
  `~/Documents`, et n'a pas de réseau.
- **Partage privé** : deux familles de routes. Les routes du propriétaire restent filtrées par `owner_id` (un membre y
  obtient 404 partout). Les routes `/shared/:grantId/…` revérifient à chaque appel : accord actif, appelant = bénéficiaire,
  cible dans le sous-arbre accordé, rien dans la corbeille ; rôle insuffisant → 403, tout le reste → 404. Octets
  imputés au quota du propriétaire, même chaîne antivirus ; un membre ne sort jamais un fichier infecté. Les
  téléversements d'un accord sont invisibles aux routes `/uploads` ordinaires. `collab/resolve` : adresse exacte,
  10 appels par minute.
- **IA** : l'invite ne contient que des passages retrouvés dans les fichiers de l'appelant ; consigne de traiter les
  passages comme des données (injection par document) ; les fournisseurs externes exigent l'interrupteur du serveur
  et celui du compte (journalisé) ; les réponses d'erreur d'un fournisseur ne sont jamais recopiées (elles peuvent
  répéter l'invite) ; la question n'est jamais journalisée. Les suggestions sont revalidées (extension inchangée,
  dossier appartenant au compte) et jamais appliquées par le serveur.
- **Collections** : une règle est une donnée ; champs et opérateurs viennent d'une liste blanche, les valeurs
  voyagent uniquement en paramètres liés ; testé contre des tentatives d'injection.
- **Événements SSE** : aucun contenu dans les événements (un numéro de révision, un type de notification) ; 16 flux
  au plus par compte ; un flux est fermé quand sa session est révoquée.
- **Piste d'audit** : les renommages y consignent l'ancien nom, les opérations groupées les identifiants (200 au plus).
