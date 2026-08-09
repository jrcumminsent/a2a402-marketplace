# Fresh Catch Customs — Premium Shopify OS 2.0 Theme

This is a separate, unpublished Shopify theme. It does not modify the live storefront.

## What is included

- Premium responsive design system using navy, charcoal, copper, leather brown, bone and white.
- Reorderable Online Store 2.0 sections for the homepage and all requested landing pages.
- Custom ordering limited to **Richardson 112** and **Richardson PTS30**.
- Native Shopify contact forms with validation, status messaging and honest artwork-upload guidance.
- Collection-powered product cards, collection filtering/sorting on collection templates, product purchase/quote flows, bulk pricing tables, accessible navigation and reduced-motion support.
- Local Fresh Catch imagery with source documentation in `ASSET-MANIFEST.md`.

## Safe upload and preview

1. In Shopify Admin, go to **Online Store → Themes**.
2. Choose **Add theme → Upload zip file**.
3. Zip the contents of this folder (the `assets`, `config`, `layout`, `locales`, `sections`, `snippets`, and `templates` folders must be at the zip root).
4. Upload it. Do **not** choose Publish.
5. Open **Customize** on the uploaded theme and configure the settings below.
6. Use **Preview** and share the preview link with stakeholders.

For Shopify CLI development:

```bash
shopify theme dev --store YOUR-STORE.myshopify.com --path .
```

This creates/uses a development theme. Do not run `shopify theme push --allow-live`.

## Theme editor configuration

- Assign the requested JSON templates to their matching pages:
  - `custom-hats` → `page.custom-hats`
  - `pre-made-hats` → `page.pre-made-hats`
  - `business-branding-program` → `page.business-branding`
  - `accessories` → `page.accessories`
  - `bulk-orders` → `page.bulk-orders`
  - `about-us` → `page.about`
  - `contact` → `page.contact`
- Select the ready-to-ship collection in the pre-made page’s product-grid section.
- Select the homepage featured collection.
- Configure menus, logo, social links and every CTA URL.
- Add only client-approved Richardson 112 and PTS30 colors as blocks in each custom-order form section.
- Replace fallback local images with higher-resolution theme-editor images as supplied.
- Confirm model-specific hat pricing before replacing “Request Current Pricing.”

## Data architecture

The launch form uses theme blocks for model-specific colors, making later color additions editor-controlled. Product merchandising uses Shopify collections/products. For scalable future expansion, create a `hat_model` metaobject with fields for name, launch-enabled flag, summary, specifications, color references, image and quote URL; keep only Richardson 112 and PTS30 enabled at launch.

Recommended product metafields:

- `custom.quote_only` — boolean; directs artwork-dependent custom products to the quote flow.
- `custom.material_details` — multi-line text.
- `custom.patch_material` — single-line text or metaobject reference.
- `custom.hat_model` — metaobject reference.
- `custom.ready_to_ship` — boolean.

No metafields/metaobjects are created automatically by a theme upload; create them in Shopify Admin before use.

## App or backend requirement

Shopify native contact forms do not reliably support retained file attachments in every configuration. Configure Shopify Forms with file support, a reputable upload app/provider, or a custom backend, then paste the secure upload URL into the Custom Order Form section. The theme intentionally does not show a fake file input.

## Missing client information

- Approved Richardson 112 color list.
- Approved Richardson PTS30 color list.
- Verified PTS30 technical specifications and closure/back details.
- Confirmation that existing “Basic Hat Pricing” maps to Richardson 112.
- Confirmation that existing “Performance Line” pricing maps to Richardson PTS30.
- Model-specific photos, acrylic examples and individual accessory-category images.
- Final contact details and preferred pickup/shipping language.
- Secure artwork upload integration.
- Final ready-to-ship collection assignment.

## Pre-launch checklist

- Configure all links, collections, menus, logo and social profiles.
- Add approved model colors; ensure no unsupported colors appear.
- Confirm model-specific pricing with the client.
- Configure and test secure artwork upload.
- Submit all native forms and verify Shopify notifications.
- Test cart, variants, inventory, checkout and quote-only metafields.
- Check page titles, descriptions, canonical URLs and redirects.
- Test keyboard navigation, focus, mobile drawer and reduced motion.
- Test at 375, 430, 768, 1024, 1440 and 1920 pixels.
- Run Theme Check and Lighthouse against the uploaded development-theme preview.
- Confirm the uploaded theme remains unpublished until final client approval.
