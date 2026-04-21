# 🚀 Spacenova Website

Welcome to the Spacenova storefront and admin system.

> **Live site:** [https://spacenova.co.uk/](https://spacenova.co.uk/)

---

## ✨ What this project is

Spacenova is a premium ecommerce website for modular magnetic space wall art, including:

- **Customer storefront** (product browsing + checkout)
- **Admin dashboard** (`/admin`)
- **Creator tool** (`/admin/creator.html`) for panel-based artwork composition
- **Netlify serverless functions** for catalogue, auth, and checkout workflows

---

## 🧱 Tech stack

- **Frontend:** HTML, CSS, vanilla JavaScript
- **Backend/API:** Netlify Functions
- **Payments:** Stripe
- **Data services:** Supabase (used by serverless flows)
- **Hosting/Deployment:** Netlify

---

## 📁 Project structure

```text
.
├── index.html                  # Main storefront entry
├── css/style.css               # Main site styling
├── js/                         # Frontend logic (shop + rendering)
├── admin/
│   ├── index.html              # Admin dashboard
│   └── creator.html            # Creator tool
├── netlify/functions/          # Serverless endpoints
├── success.html                # Post-checkout success page
├── favicon.ico
├── Spacenovafavicon.png
└── site.webmanifest
```

---

## 🔐 Environment notes

Some functionality depends on environment variables/secrets configured in Netlify, for example:

- Stripe keys
- Supabase credentials
- Admin/auth function secrets

Do **not** hardcode secrets in source.

---

## 🛠️ Local development

### 1) Install dependencies

```bash
npm install
```

### 2) Run with Netlify CLI (recommended)

```bash
netlify dev
```

This gives you the frontend + functions together locally.

---

## 🚢 Deployment

This project is intended to deploy on **Netlify**.

Typical flow:

1. Push branch changes
2. Open PR
3. Merge into deploy branch
4. Netlify builds/deploys automatically

---

## 🧪 Quality checks

Useful checks before merge:

```bash
git diff --check
python -m json.tool site.webmanifest
```

---

## 📌 Notes

- The creator supports multi-panel composition and export workflows.
- Admin pages depend on successful responses from `/.netlify/functions/*` endpoints.
- Keep visual updates consistent with Spacenova’s premium/luxury design language.

---

## 👤 Maintainer

Spacenova team
