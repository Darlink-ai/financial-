# Factura — déploiement Supabase + Vercel + NDD

Trois étapes : (1) faire tourner localement, (2) déployer la DB sur Supabase Cloud, (3) déployer l'app sur Vercel avec un vrai NDD.

---

## 1. Local (Supabase CLI)

### Pré-requis
- **Docker Desktop** installé et lancé
- **Supabase CLI** : `brew install supabase/tap/supabase` (ou voir https://supabase.com/docs/guides/cli)

### Démarrage
```bash
cd invoice-classifier
supabase start              # télécharge les images Docker, lance Postgres + Studio + Auth
```

À la fin, la CLI affiche un bloc :
```
API URL:            http://127.0.0.1:54321
DB URL:             postgresql://postgres:postgres@127.0.0.1:54322/postgres
Studio URL:         http://127.0.0.1:54323
anon key:           eyJhbGc...
service_role key:   eyJhbGc...
```

Copie ces valeurs dans `.env.local` (en t'inspirant de `.env.local.example`).

### Appliquer les migrations
```bash
supabase db reset           # exécute supabase/migrations/*.sql sur la DB locale
```

Puis :
```bash
npm run dev
```

Au premier `/api/state`, l'app détecte la DB vide et seede les données de démo (mêmes que celles vues jusqu'ici).

### Studio (GUI)
Ouvre **http://127.0.0.1:54323** : interface web pour explorer les tables, lancer du SQL, voir les logs.

### Arrêter
```bash
supabase stop
```
Les données sont préservées (volume Docker). Pour repartir de zéro : `supabase db reset`.

---

## 2. Supabase Cloud (DB en production)

1. Crée un compte sur **https://supabase.com** (free tier OK : 500 MB DB, 1 GB storage).
2. **New project** → choisis une région proche (Frankfurt si Europe). Note bien le mot de passe DB.
3. Une fois prêt, dans **Project Settings → Database → Connection string → URI**, copie la chaîne **Pooler** (port 6543, format `postgres://postgres.<ref>:****@aws-0-...pooler.supabase.com:6543/postgres`). C'est elle qu'on utilise sur Vercel (serverless-friendly).

### Lier le projet local au cloud
```bash
supabase login
supabase link --project-ref <ref>      # <ref> = abcdefghijkl, visible dans l'URL du dashboard
supabase db push                         # applique supabase/migrations/* sur la DB cloud
```

À ce stade, ta DB de prod a le bon schéma, vide.

---

## 3. Vercel (hébergement de l'app)

1. Push le projet sur **GitHub** (privé OK).
2. Crée un compte sur **https://vercel.com** → **Add New → Project** → importe le repo.
3. **Root directory** : `invoice-classifier/` (si le repo contient plusieurs apps).
4. **Environment Variables** (Project Settings → Environment Variables) :
   - `DATABASE_URL` = chaîne pooler copiée à l'étape 2
   - `NEXT_PUBLIC_SUPABASE_URL` = URL Supabase (Project Settings → API)
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = anon key
   - `SUPABASE_SERVICE_ROLE_KEY` = service role key (Production scope uniquement)
5. **Deploy**. Au premier hit sur `/api/state`, le seed se lance automatiquement.

L'app est en ligne sur `<projet>.vercel.app`. Teste-la.

---

## 4. Brancher ton NDD

1. **Achète ton domaine** chez un registrar :
   - 🇨🇭 **Infomaniak** (Swiss, support FR) — recommandé si tu es en Suisse
   - 🌍 **Cloudflare Registrar** (prix coûtant, super rapide) ou **Namecheap**, **OVH**

2. Dans **Vercel → Project → Settings → Domains** :
   - Add `factura.ton-domaine.ch` (ou root `ton-domaine.ch`)
   - Vercel affiche les enregistrements DNS à créer (CNAME ou A)

3. Chez ton registrar, **DNS Management** :
   - Pour un **sous-domaine** : ajoute un `CNAME` → `cname.vercel-dns.com`
   - Pour le **domaine racine** : ajoute un `A` → `76.76.21.21` (Vercel te donnera la bonne valeur)

4. Attends 5-30 min (propagation DNS). Vercel détecte automatiquement et émet le certificat HTTPS Let's Encrypt.

5. ✅ Ton app est en ligne sur ton NDD avec HTTPS gratuit.

---

## Commandes utiles

```bash
# Local
supabase start                         # lancer DB locale
supabase stop                          # arrêter
supabase db reset                      # vider + reseeder
supabase studio                        # ouvre le GUI dans le navigateur
npm run dev                            # lance Next.js

# Cloud
supabase db push                       # pousse les nouvelles migrations vers le cloud
supabase db pull                       # récupère le schéma cloud → fichier de migration

# Vercel
vercel                                 # déploiement manuel (sinon auto via GitHub)
vercel logs                            # logs production
vercel env pull .env.local             # récupère les variables d'env du projet
```

---

## Ajout d'une migration

Quand tu modifies le schéma :

```bash
supabase migration new <nom>           # crée supabase/migrations/<ts>_<nom>.sql
# édite le fichier SQL
supabase db reset                      # applique en local
supabase db push                       # applique en prod
```

---

## Problèmes courants

- **`Impossible de joindre la base Postgres`** au démarrage → `supabase start` n'est pas lancé, ou `DATABASE_URL` pointe ailleurs. Vérifie avec `psql $DATABASE_URL -c "SELECT 1"`.
- **Vercel build fail** → vérifie que `DATABASE_URL` est bien défini dans les env vars du projet (sinon `npm run build` échoue car les routes API tentent de connecter à la DB pendant le SSG).
- **DB en prod vide après deploy** → c'est normal : le seed mock ne se déclenche que si la DB est vide ET que tu visites `/api/state` une première fois. Sinon : `supabase db push` puis ouvre `/api/state` une fois.
