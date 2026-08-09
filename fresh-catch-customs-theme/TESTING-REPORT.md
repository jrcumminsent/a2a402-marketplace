# Testing Report

## Completed locally

- Parsed all JSON theme templates.
- Confirmed the custom-order model selector contains only `Richardson 112` and `Richardson PTS30`.
- Confirmed no “Other” hat-model option exists.
- Confirmed no Yupoong, rope, generic performance, water-resistant, or alternate Richardson model is presented as a custom-order option.
- Confirmed all local fallback asset references have matching files.
- Implemented semantic labels, focus styles, status regions, accessible native details/summary accordions, reduced-motion handling and a keyboard-operable navigation drawer.
- Separated ready-to-ship checkout and quote-only product behavior with `custom.quote_only`.

## Requires a Shopify development theme

- Liquid runtime rendering and Theme Check with Shopify’s current rules.
- Shopify contact form delivery, spam handling and notifications.
- Storefront filtering availability (depends on Search & Discovery configuration).
- Product variants, inventory, cart and checkout.
- Merchant menu/collection/page assignments.
- Lighthouse scores and final breakpoint screenshots.
- Console-error check on rendered Shopify pages.

## Known limitations

- The page-based Pre-Made Hats template can display a selected collection, but Shopify’s native URL-based filters and sorting work most completely on the collection template. For full filter behavior, link `/pages/pre-made-hats` to a dedicated ready-to-ship collection or configure a redirect after stakeholder approval.
- Artwork upload needs Shopify Forms, an upload app/provider or a custom backend.
- Exact model-specific colors and PTS30 specifications are intentionally absent until approved.
- Existing hat price tables are preserved separately and are not falsely assigned to Richardson 112 or PTS30.
