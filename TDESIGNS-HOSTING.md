# T-Designs website hosting

The complete upload-ready website is in `tdesigns-netlify`.

## Publish on Netlify

### Fastest option: Netlify Drop

1. Sign in to Netlify.
2. Open [Netlify Drop](https://app.netlify.com/drop).
3. Upload `tdesigns-netlify-upload.zip`, or drag the entire `tdesigns-netlify` folder onto the page.
4. Netlify will publish the site and provide a temporary `*.netlify.app` address.
5. In **Site configuration → Domain management**, connect the final domain when it is ready.

`index.html` is already at the root. There is no build command and the publish directory is `.`.

### Git-connected option

If the entire `agent2agent` repository is connected to Netlify, set:

- Base directory: `tdesigns-netlify`
- Build command: leave blank
- Publish directory: `.`

## Quote requests

The site contains two forms prepared for Netlify Forms:

- `tdesigns-project-quote` handles embroidery, engraving, patches, apparel, signs, banners, gifts, and other custom work.
- `tdesigns-quote` handles the interactive custom-hat designer and generated mockup.

After the first deployment:

1. Open **Forms** in the Netlify dashboard.
2. Confirm that both form names appear.
3. Submit one general project request with artwork.
4. Submit one hat request with artwork and multiple embroidery placements.
5. Confirm that the generated hat quote sheet contains every selected view.
6. Configure notifications for both forms to reach the T-Designs owner.

## Connect the existing quote app

Edit `tdesigns-netlify/assets/config.js` and place the existing quote-app URL between the quotes:

```js
quoteAppUrl: "https://example.com/your-quote-app"
```

When a valid `https://` URL is present, an **Open quote app** button appears inside Shop Tools. The complete quote packet is copied so it can be pasted into the existing app.

Do not place API keys, private formulas, or passwords in this file; browser JavaScript is public. A direct API integration needs the app URL, API documentation, authentication method, and input/output fields.

## Connect Square purchasing

The public site is prepared for two Square purchase paths without exposing private Square credentials.

### Link the main Square storefront

Edit `tdesigns-netlify/assets/config.js` and paste the client’s public Square Online store URL:

```js
squareStoreUrl: "https://your-shop.square.site"
```

This changes the shop buttons and navigation to open the Square storefront. This URL is public; never place a Square access token, application secret, password, or private key in the file.

### Add a buy button to one inventory item

Create a **Sell an item** Payment Link in the client’s Square Dashboard. Then open `tdesigns-owner-tools/inventory-manager.html` and add:

- the price as cents, such as `3200` for $32.00;
- `USD`;
- the active Square Payment Link for that exact item.

After exporting and publishing the updated `inventory.csv`, an `In stock` or `Limited` item receives a **Buy now with Square** button. Special-order items and items without a link remain quote-only.

Custom work remains quote-first because the product, artwork, quantity, process, placement, availability, shipping, and production details affect the final price. After approval, T-Designs can send the customer a Square invoice or exact payment link.

## Publish real hat inventory

The website reads `tdesigns-netlify/assets/inventory.csv`. See `TDESIGNS-INVENTORY.md` for the columns and an example.

The shipped inventory file is intentionally empty because T-Designs has not supplied the real on-hand stock list. This prevents the website from publishing made-up availability.

The separate `tdesigns-owner-tools/inventory-manager.html` file is a local CSV editor. It is not a hosted database and does not publish changes automatically.

## Before the final domain launch

- Add the final HTTPS domain to `siteUrl` in `tdesigns-netlify/assets/config.js`. The live page will then use it for its canonical URL, social URL, social image URL, and structured-data URLs.
- Send the final domain back to Codex so `sitemap.xml`, the `robots.txt` sitemap line, and fully static absolute metadata can be finalized without guessing the domain.
- Confirm the exact capitalization and spelling of every hat brand.
- Confirm the final list of products offered for engraving, apparel decoration, signage, banners, and gifts.
- Confirm how long uploaded customer artwork should be retained.
- Confirm whether leather and UV-printed patches are available anywhere besides the front.
