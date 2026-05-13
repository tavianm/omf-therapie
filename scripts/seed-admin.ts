/**
 * Script de création du compte admin initial pour OMF Thérapie
 *
 * Usage :
 *   npx tsx scripts/seed-admin.ts
 *
 * Variables d'env requises (dans .env) :
 *   BETTER_AUTH_URL  — URL du site (ex: http://localhost:4321 en dev)
 *   ADMIN_EMAIL      — email du compte admin à créer
 *   ADMIN_PASSWORD   — mot de passe du compte admin
 *   ADMIN_NAME       — nom affiché (ex: "Oriane Montabonnet")
 *
 * Ce script utilise l'API BetterAuth directement via fetch.
 * Il ne peut créer qu'un seul compte (le hook anti-inscription bloque les suivants).
 */

import 'dotenv/config';

const baseURL = process.env.BETTER_AUTH_URL ?? 'http://localhost:4321';
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
const name = process.env.ADMIN_NAME ?? 'Oriane Montabonnet';

if (!email || !password) {
  console.error('❌ ADMIN_EMAIL et ADMIN_PASSWORD sont requis dans .env');
  process.exit(1);
}

async function seedAdmin() {
  console.log(`\n🔑 Création du compte admin : ${email}`);
  console.log(`   Endpoint : ${baseURL}/api/auth/sign-up/email\n`);

  const response = await fetch(`${baseURL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error(`❌ Échec (${response.status}):`, data);
    process.exit(1);
  }

  console.log('✅ Compte admin créé avec succès !');
  console.log(`   Email    : ${email}`);
  console.log(`   Nom      : ${name}`);
  console.log('\n⚠️  Notez ces identifiants en lieu sûr — le mot de passe ne peut pas être récupéré.');
}

seedAdmin().catch((err) => {
  console.error('❌ Erreur inattendue :', err);
  process.exit(1);
});
