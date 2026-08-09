# T-Designs inventory manager

`inventory-manager.html` is a self-contained, local-only editor for the public website's `assets/inventory.csv`.

## Use it

1. Double-click `inventory-manager.html` to open it in a browser.
2. Choose **Open inventory.csv** and select `tdesigns-netlify/assets/inventory.csv`.
3. Add, edit, or remove confirmed hat inventory.
4. Choose **Export inventory.csv**.
5. Replace `tdesigns-netlify/assets/inventory.csv` with the exported file.
6. Redeploy `tdesigns-netlify` to publish the change.

The optional browser draft is stored only in that browser on that computer. This tool is unauthenticated, does not use the network, and cannot publish the website automatically.

## CSV contract

The export columns are:

```text
id,brand,model,color,profile,status,quantity_label,image
```

Required fields are `id`, `brand`, `model`, `color`, `profile`, and `status`. IDs must be unique.

Allowed status values:

- `In stock`
- `Limited`
- `Special order`

Allowed brands:

- Outdoor Cap
- Otto
- Cambridge
- Richardson
- Legacy
- Zapped
- Anyrope
- Durability
- New Era
- Pacific Headwear
- Nike

`quantity_label` and `image` are optional. If an image is used, place it inside the public site and enter a site-relative path such as `assets/hats/td-001.jpg`. CSV values containing commas, quotes, or line breaks are escaped automatically on export.
