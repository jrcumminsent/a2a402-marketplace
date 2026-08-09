# T-Designs inventory file

The public inventory section reads `tdesigns-netlify/assets/inventory.csv`.

Keep the header row and add one row per hat and color combination:

```csv
id,brand,model,color,profile,status,quantity_label,image,price_minor_units,currency,square_url
td-001,Outdoor Cap,REPLACE-WITH-MODEL,REPLACE-WITH-COLOR,Trucker,In stock,Ready now,assets/hats/td-001.jpg,3200,USD,https://square.link/u/REPLACE
```

Allowed `status` values:

- `In stock`
- `Limited`
- `Special order`

The `image` field is optional. When it is blank, the site displays a generated hat illustration. Use a path inside the deployed folder, such as `assets/hats/filename.jpg`.

The Square fields are optional:

- `price_minor_units` is the whole price in cents. For example, `3200` displays as `$32.00`.
- `currency` should normally be `USD`.
- `square_url` is the active HTTPS Square Payment Link for that exact item.

An `In stock` or `Limited` row with a valid `square_url` receives a **Buy now with Square** button. A special-order row or a row without a payment link stays quote-only. The price shown on the website is informational; the price and availability shown by Square at checkout are final.

Do not publish sample rows as real stock. The shipped file intentionally contains only the header until T-Designs supplies its actual on-hand inventory.

For a no-code editing workflow, open `tdesigns-owner-tools/inventory-manager.html` locally, import the current CSV, make the changes, export the new file, and replace `tdesigns-netlify/assets/inventory.csv` before uploading the site again.
