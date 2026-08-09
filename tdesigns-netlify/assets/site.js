(() => {
  "use strict";

  const menuButton = document.querySelector("[data-menu-button]");
  const mobileMenu = document.querySelector("[data-mobile-menu]");

  if (menuButton && mobileMenu) {
    const closeMobileMenu = () => {
      menuButton.setAttribute("aria-expanded", "false");
      menuButton.setAttribute("aria-label", "Open menu");
      mobileMenu.setAttribute("aria-hidden", "true");
    };

    menuButton.addEventListener("click", () => {
      const open = menuButton.getAttribute("aria-expanded") === "true";
      menuButton.setAttribute("aria-expanded", String(!open));
      menuButton.setAttribute("aria-label", open ? "Open menu" : "Close menu");
      mobileMenu.setAttribute("aria-hidden", String(open));
    });

    mobileMenu.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", closeMobileMenu);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && menuButton.getAttribute("aria-expanded") === "true") {
        closeMobileMenu();
        menuButton.focus();
      }
    });

    document.addEventListener("pointerdown", (event) => {
      const header = menuButton.closest(".site-header");
      if (menuButton.getAttribute("aria-expanded") === "true" && header && !header.contains(event.target)) {
        closeMobileMenu();
      }
    });

    const desktopNavigation = window.matchMedia("(min-width: 1181px)");
    desktopNavigation.addEventListener?.("change", (event) => {
      if (event.matches) closeMobileMenu();
    });
  }

  const config = window.TDESIGNS_CONFIG || {};
  const quoteAppLink = document.querySelector("[data-quote-app]");

  function validHttpsUrl(value) {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }

  function validSquareCheckoutUrl(value) {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      return url.protocol === "https:" && (
        host === "square.link"
        || host === "checkout.square.site"
        || host.endsWith(".square.site")
      );
    } catch {
      return false;
    }
  }

  if (quoteAppLink && validHttpsUrl(config.quoteAppUrl || "")) {
    quoteAppLink.href = config.quoteAppUrl;
    quoteAppLink.hidden = false;
  }

  const squareStoreUrl = validHttpsUrl(config.squareStoreUrl || "") ? config.squareStoreUrl : "";
  if (squareStoreUrl) {
    document.querySelectorAll("[data-square-store]").forEach((link) => {
      link.href = squareStoreUrl;
      link.removeAttribute("target");
      link.removeAttribute("rel");
    });
    document.querySelectorAll("[data-square-label]").forEach((label) => {
      label.textContent = "Shop on Square";
    });
    document.querySelectorAll("[data-square-nav]").forEach((link) => {
      link.href = squareStoreUrl;
      link.hidden = false;
    });
    const squareStatus = document.querySelector("[data-square-status]");
    if (squareStatus) {
      squareStatus.textContent = "Continue to T-Designs’ Square storefront for current items, prices, and checkout.";
    }
  }

  const configuredSiteUrl = validHttpsUrl(config.siteUrl || "")
    ? new URL("/", config.siteUrl).href
    : "";
  const liveSiteUrl = location.protocol === "https:" && !["localhost", "127.0.0.1"].includes(location.hostname)
    ? new URL("/", location.href).href
    : "";
  const canonicalUrl = configuredSiteUrl || liveSiteUrl;

  if (canonicalUrl) {
    const canonicalLink = document.querySelector("[data-canonical-url]");
    const hreflangLink = document.querySelector("[data-hreflang-url]");
    const ogUrl = document.querySelector("[data-og-url]");
    if (canonicalLink) canonicalLink.href = canonicalUrl;
    if (hreflangLink) hreflangLink.href = canonicalUrl;
    if (ogUrl) ogUrl.content = canonicalUrl;

    const absoluteSocialImage = new URL("assets/og-full-service.png", canonicalUrl).href;
    const ogImage = document.querySelector('meta[property="og:image"]');
    const twitterImage = document.querySelector('meta[name="twitter:image"]');
    if (ogImage) ogImage.content = absoluteSocialImage;
    if (twitterImage) twitterImage.content = absoluteSocialImage;

    const structuredData = document.querySelector("[data-structured-data]");
    if (structuredData) {
      try {
        const schema = JSON.parse(structuredData.textContent);
        const absolutize = (value) => {
          if (Array.isArray(value)) return value.map(absolutize);
          if (value && typeof value === "object") {
            return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, absolutize(child)]));
          }
          if (typeof value === "string" && value.startsWith("/")) {
            return new URL(value.slice(1), canonicalUrl).href;
          }
          return value;
        };
        structuredData.textContent = JSON.stringify(absolutize(schema));
      } catch {
        // The static JSON-LD remains usable if runtime enhancement is unavailable.
      }
    }
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;

    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      const next = text[index + 1];

      if (character === '"' && quoted && next === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = !quoted;
      } else if (character === "," && !quoted) {
        row.push(cell.trim());
        cell = "";
      } else if ((character === "\n" || character === "\r") && !quoted) {
        if (character === "\r" && next === "\n") index += 1;
        row.push(cell.trim());
        if (row.some(Boolean)) rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += character;
      }
    }

    row.push(cell.trim());
    if (row.some(Boolean)) rows.push(row);
    if (rows.length < 2) return [];

    const headers = rows[0].map((header) => header.toLowerCase());
    return rows.slice(1).map((values) => {
      const item = {};
      headers.forEach((header, index) => {
        item[header] = values[index] || "";
      });
      return item;
    }).filter((item) => item.id && item.brand && item.model);
  }

  const inventoryGrid = document.querySelector("[data-inventory-grid]");
  const inventoryEmpty = document.querySelector("[data-inventory-empty]");
  const inventoryCount = document.querySelector("[data-inventory-count]");
  const inventorySearch = document.querySelector("[data-inventory-search]");
  const inventoryBrand = document.querySelector("[data-inventory-brand]");
  const inventoryStatus = document.querySelector("[data-inventory-status]");
  let inventoryItems = [];

  function statusClass(status) {
    if (status.toLowerCase() === "in stock") return "is-stock";
    if (status.toLowerCase() === "limited") return "is-limited";
    return "";
  }

  function formattedInventoryPrice(item) {
    const amount = Number(item.price_minor_units);
    if (!Number.isInteger(amount) || amount < 0) return "";
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: (item.currency || "USD").toUpperCase()
      }).format(amount / 100);
    } catch {
      return `$${(amount / 100).toFixed(2)}`;
    }
  }

  function createInventoryCard(item) {
    const article = document.createElement("article");
    article.className = "inventory-card";

    const art = document.createElement("div");
    art.className = "inventory-art";

    const badge = document.createElement("span");
    badge.className = `inventory-status ${statusClass(item.status)}`.trim();
    badge.textContent = item.status || "Ask for availability";
    art.append(badge);

    if (/^(assets\/|https:\/\/)/i.test(item.image || "")) {
      const image = document.createElement("img");
      image.src = item.image;
      image.alt = `${item.brand} ${item.model} in ${item.color}`;
      image.loading = "lazy";
      art.append(image);
    } else {
      const cap = document.createElement("div");
      cap.className = "inventory-cap";
      cap.setAttribute("aria-hidden", "true");
      art.append(cap);
    }

    const copy = document.createElement("div");
    copy.className = "inventory-card-copy";

    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = item.brand;

    const heading = document.createElement("h3");
    heading.textContent = item.model;

    const meta = document.createElement("div");
    meta.className = "inventory-meta";
    [item.color, item.profile, item.quantity_label].filter(Boolean).forEach((value) => {
      const span = document.createElement("span");
      span.textContent = value;
      meta.append(span);
    });

    const price = formattedInventoryPrice(item);
    const priceNode = document.createElement("p");
    priceNode.className = "inventory-price";
    priceNode.textContent = price;
    priceNode.hidden = !price;

    const actions = document.createElement("div");
    actions.className = "inventory-card-actions";

    const customizeButton = document.createElement("button");
    customizeButton.type = "button";
    customizeButton.className = "inventory-customize";
    customizeButton.textContent = "Customize this hat";
    customizeButton.addEventListener("click", () => {
      const brandSelect = document.querySelector("[data-brand-select]");
      const profileSelect = document.querySelector("[data-profile-select]");
      const modelInput = document.querySelector("[data-model-input]");
      const colorRequest = document.querySelector('input[name="preferred_hat_color"]');
      const inventoryIdInput = document.querySelector("[data-inventory-id]");
      const colorRadios = [...document.querySelectorAll('input[name="preview_color"]')];

      if (brandSelect && [...brandSelect.options].some((option) => option.value === item.brand)) {
        brandSelect.value = item.brand;
        brandSelect.dispatchEvent(new Event("change", {bubbles: true}));
      }
      if (profileSelect && [...profileSelect.options].some((option) => option.value === item.profile)) {
        profileSelect.value = item.profile;
        profileSelect.dispatchEvent(new Event("change", {bubbles: true}));
      }
      if (modelInput) {
        modelInput.value = item.model;
        modelInput.dispatchEvent(new Event("input", {bubbles: true}));
      }
      if (colorRequest) colorRequest.value = item.color;
      const matchingColor = colorRadios.find((radio) => {
        return (item.color || "").toLowerCase().includes(radio.value.toLowerCase());
      });
      if (matchingColor) {
        matchingColor.checked = true;
        matchingColor.dispatchEvent(new Event("change", {bubbles: true}));
      }
      if (inventoryIdInput) inventoryIdInput.value = item.id;
      document.querySelector("#studio")?.scrollIntoView({behavior: "smooth"});
    });

    const checkoutAvailable = ["in stock", "limited"].includes((item.status || "").toLowerCase())
      && validSquareCheckoutUrl(item.square_url || "");

    if (checkoutAvailable) {
      const buyLink = document.createElement("a");
      buyLink.className = "inventory-buy";
      buyLink.href = item.square_url;
      buyLink.setAttribute("aria-label", `Buy ${item.brand} ${item.model} through Square`);
      buyLink.innerHTML = '<span class="material-symbols-rounded" aria-hidden="true">shopping_cart_checkout</span>Buy now with Square';
      actions.append(buyLink);
    }

    actions.append(customizeButton);
    copy.append(eyebrow, heading, meta, priceNode, actions);

    if (checkoutAvailable) {
      const checkoutNote = document.createElement("p");
      checkoutNote.className = "inventory-checkout-note";
      checkoutNote.innerHTML = '<span class="material-symbols-rounded" aria-hidden="true">lock</span>Secure checkout handled by Square';
      copy.append(checkoutNote);
    }

    article.append(art, copy);
    return article;
  }

  function renderInventory() {
    if (!inventoryGrid || !inventoryEmpty || !inventoryCount) return;

    const query = (inventorySearch?.value || "").trim().toLowerCase();
    const brand = inventoryBrand?.value || "";
    const status = inventoryStatus?.value || "";
    const filtered = inventoryItems.filter((item) => {
      const searchable = [item.brand, item.model, item.color, item.profile].join(" ").toLowerCase();
      return (!query || searchable.includes(query))
        && (!brand || item.brand === brand)
        && (!status || item.status === status);
    });

    inventoryGrid.replaceChildren(...filtered.map(createInventoryCard));
    inventoryGrid.hidden = filtered.length === 0;
    inventoryEmpty.hidden = filtered.length !== 0;
    inventoryCount.textContent = `${filtered.length} ${filtered.length === 1 ? "hat option" : "hat options"}`;

    if (inventoryItems.length > 0 && filtered.length === 0) {
      inventoryEmpty.querySelector(".eyebrow").textContent = "No filter matches";
      inventoryEmpty.querySelector("h3").textContent = "Try a different brand or search.";
      inventoryEmpty.querySelector("p:not(.eyebrow)").textContent = "Clear the filters to see every published hat, or choose any supported brand in the mockup studio.";
    } else if (inventoryItems.length === 0) {
      inventoryEmpty.querySelector(".eyebrow").textContent = "Stock list pending";
      inventoryEmpty.querySelector("h3").textContent = "No hats have been published here yet.";
      inventoryEmpty.querySelector("p:not(.eyebrow)").textContent = "That does not limit what T-Designs can order. Pick a brand in the studio or message the shop for the latest on-hand options.";
    }
  }

  if (inventoryGrid) {
    fetch("assets/inventory.csv", {cache: "no-store"})
      .then((response) => {
        if (!response.ok) throw new Error("Inventory unavailable");
        return response.text();
      })
      .then((text) => {
        inventoryItems = parseCsv(text);
        renderInventory();
      })
      .catch(() => {
        inventoryItems = [];
        renderInventory();
      });

    [inventorySearch, inventoryBrand, inventoryStatus].forEach((control) => {
      control?.addEventListener(control.matches("input") ? "input" : "change", renderInventory);
    });
  }

  const form = document.querySelector("[data-mockup-form]");
  const canvas = document.querySelector("[data-hat-canvas]");

  if (!form || !canvas) return;

  const studio = document.querySelector(".studio");
  const studioPreview = document.querySelector(".studio-preview");
  const contactStep = form.querySelector(".contact-step");
  if (studio && studioPreview && contactStep) {
    const previewHome = document.createComment("studio preview");
    studio.insertBefore(previewHome, studioPreview);
    const compactStudio = window.matchMedia("(max-width: 1180px)");
    const arrangeStudio = () => {
      if (compactStudio.matches) {
        contactStep.before(studioPreview);
      } else {
        previewHome.after(studioPreview);
      }
    };
    arrangeStudio();
    compactStudio.addEventListener?.("change", arrangeStudio);
  }

  const context = canvas.getContext("2d");
  const logoInput = form.querySelector("[data-logo-input]");
  const previewText = form.querySelector("[data-preview-text]");
  const brandSelect = form.querySelector("[data-brand-select]");
  const profileSelect = form.querySelector("[data-profile-select]");
  const modelInput = form.querySelector("[data-model-input]");
  const preferredColorInput = form.querySelector('input[name="preferred_hat_color"]');
  const shapeSelect = form.querySelector("[data-shape-select]");
  const patchOptions = form.querySelector("[data-patch-options]");
  const uploadStatus = form.querySelector("[data-upload-status]");
  const uploadName = form.querySelector("[data-upload-name]");
  const removeLogo = form.querySelector("[data-remove-logo]");
  const generatedFile = form.querySelector("[data-generated-file]");
  const referenceInput = form.querySelector("[data-reference-input]");
  const settingsInput = form.querySelector("[data-settings-input]");
  const inventoryIdInput = form.querySelector("[data-inventory-id]");
  const submitButton = form.querySelector("[data-submit-button]");
  const summaryHat = document.querySelector("[data-summary-hat]");
  const summaryMethod = document.querySelector("[data-summary-method]");
  const summaryView = document.querySelector("[data-summary-view]");
  const summaryReference = document.querySelector("[data-summary-reference]");
  const downloadButton = document.querySelector("[data-download-mockup]");
  const resetButton = document.querySelector("[data-reset-mockup]");
  const copyButton = document.querySelector("[data-copy-summary]");
  const toolFeedback = document.querySelector("[data-tool-feedback]");
  const sizeControl = document.querySelector("[data-size-control]");
  const rotationControl = document.querySelector("[data-rotation-control]");
  const logoSizeControl = document.querySelector("[data-logo-size-control]");
  const sizeOutput = document.querySelector("[data-size-output]");
  const rotationOutput = document.querySelector("[data-rotation-output]");
  const logoSizeOutput = document.querySelector("[data-logo-size-output]");
  const viewButtons = [...document.querySelectorAll("[data-view-button]")];
  const nudgeButtons = [...document.querySelectorAll("[data-nudge-x][data-nudge-y]")];
  const placementChecks = [...form.querySelectorAll("[data-placement-check]")];
  const placementCopy = form.querySelector("[data-placement-copy]");

  const viewNames = {
    front: "Front",
    left: "Left side",
    right: "Right side",
    back: "Back"
  };

  const state = {
    brand: "Help me choose",
    profile: "Trucker",
    model: "",
    tone: "#161719",
    toneName: "Black",
    method: "Embroidery",
    shape: "rounded",
    activeView: "front",
    placements: new Set(["front"]),
    text: "YOUR LOGO",
    logo: null,
    decorationScale: 1,
    rotation: 0,
    logoScale: 1,
    offsets: {
      front: {x: 0, y: 0},
      left: {x: 0, y: 0},
      right: {x: 0, y: 0},
      back: {x: 0, y: 0}
    }
  };

  function makeReference() {
    if (globalThis.crypto?.randomUUID) {
      return `TD-${globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase()}`;
    }
    return `TD-${Date.now().toString(36).slice(-5).toUpperCase()}${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
  }

  const reference = makeReference();
  referenceInput.value = reference;
  summaryReference.textContent = reference;

  function hexToRgb(hex) {
    const value = Number.parseInt(hex.replace("#", ""), 16);
    return {
      r: value >> 16,
      g: (value >> 8) & 255,
      b: value & 255
    };
  }

  function shade(hex, amount) {
    const color = hexToRgb(hex);
    return `rgb(${Math.max(0, Math.min(255, color.r + amount))}, ${Math.max(0, Math.min(255, color.g + amount))}, ${Math.max(0, Math.min(255, color.b + amount))})`;
  }

  function contrastColor(hex) {
    const {r, g, b} = hexToRgb(hex);
    return (r * 299 + g * 587 + b * 114) / 1000 > 155 ? "#111111" : "#ffffff";
  }

  function roundedRectPath(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function patchPath(ctx, x, y, width, height) {
    if (state.shape === "circle") {
      ctx.beginPath();
      ctx.arc(x + width / 2, y + height / 2, Math.min(width, height) / 2, 0, Math.PI * 2);
    } else if (state.shape === "oval") {
      ctx.beginPath();
      ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
    } else if (state.shape === "hex") {
      const inset = width * 0.17;
      ctx.beginPath();
      ctx.moveTo(x + inset, y);
      ctx.lineTo(x + width - inset, y);
      ctx.lineTo(x + width, y + height / 2);
      ctx.lineTo(x + width - inset, y + height);
      ctx.lineTo(x + inset, y + height);
      ctx.lineTo(x, y + height / 2);
      ctx.closePath();
    } else {
      roundedRectPath(ctx, x, y, width, height, state.shape === "rectangle" ? 3 : 15);
    }
  }

  function drawBackground() {
    const backdrop = context.createRadialGradient(500, 236, 28, 500, 304, 690);
    backdrop.addColorStop(0, "#fffef9");
    backdrop.addColorStop(0.48, "#f0ebe2");
    backdrop.addColorStop(0.8, "#ded7ca");
    backdrop.addColorStop(1, "#c8bfb1");
    context.fillStyle = backdrop;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const warmLight = context.createRadialGradient(510, 330, 20, 510, 330, 440);
    warmLight.addColorStop(0, "rgba(255,194,41,.13)");
    warmLight.addColorStop(0.52, "rgba(255,194,41,.035)");
    warmLight.addColorStop(1, "rgba(255,194,41,0)");
    context.fillStyle = warmLight;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const floor = context.createLinearGradient(0, 515, 0, canvas.height);
    floor.addColorStop(0, "rgba(255,255,255,0)");
    floor.addColorStop(0.34, "rgba(255,255,255,.16)");
    floor.addColorStop(1, "rgba(56,47,37,.1)");
    context.fillStyle = floor;
    context.fillRect(0, 505, canvas.width, canvas.height - 505);

    const vignette = context.createRadialGradient(500, 360, 260, 500, 360, 660);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(0.76, "rgba(0,0,0,.025)");
    vignette.addColorStop(1, "rgba(0,0,0,.13)");
    context.fillStyle = vignette;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  function rgbaTone(hex, alpha) {
    const {r, g, b} = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function profileGeometry() {
    const lowCrown = state.profile === "Dad Cap";
    const flatBill = state.profile === "Flat Bill";
    return {
      top: lowCrown ? 214 : flatBill ? 158 : 177,
      base: lowCrown ? 525 : 518,
      flatBill,
      soft: lowCrown || state.profile === "Not sure",
      mesh: state.profile === "Trucker",
      rope: state.profile === "Rope",
      perforated: state.profile === "Performance"
    };
  }

  function drawContactShadow(cx, cy, rx, ry, opacity = 0.24) {
    context.save();
    context.translate(cx, cy);
    context.scale(rx, ry);
    const shadow = context.createRadialGradient(0, 0, 0.08, 0, 0, 1);
    shadow.addColorStop(0, `rgba(0,0,0,${opacity})`);
    shadow.addColorStop(0.6, `rgba(0,0,0,${opacity * 0.58})`);
    shadow.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = shadow;
    context.beginPath();
    context.arc(0, 0, 1, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  function drawFabricTexture(pathBuilder, bounds) {
    context.save();
    pathBuilder();
    context.clip();
    context.strokeStyle = "rgba(255,255,255,.028)";
    context.lineWidth = 1;
    for (let y = bounds.y; y <= bounds.y + bounds.height; y += 7) {
      context.beginPath();
      context.moveTo(bounds.x, y);
      context.lineTo(bounds.x + bounds.width, y + 2);
      context.stroke();
    }
    context.strokeStyle = "rgba(0,0,0,.022)";
    for (let x = bounds.x; x <= bounds.x + bounds.width; x += 9) {
      context.beginPath();
      context.moveTo(x, bounds.y);
      context.lineTo(x - 5, bounds.y + bounds.height);
      context.stroke();
    }
    context.restore();
  }

  function drawMesh(pathBuilder, bounds, spacing = 17) {
    context.save();
    pathBuilder();
    context.clip();

    const meshBase = context.createLinearGradient(bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height);
    meshBase.addColorStop(0, shade(state.tone, 12));
    meshBase.addColorStop(0.55, shade(state.tone, -13));
    meshBase.addColorStop(1, shade(state.tone, -31));
    context.fillStyle = meshBase;
    context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);

    context.lineWidth = 1.25;
    context.strokeStyle = "rgba(255,255,255,.25)";
    for (let x = bounds.x - bounds.height; x < bounds.x + bounds.width + bounds.height; x += spacing) {
      context.beginPath();
      context.moveTo(x, bounds.y);
      context.lineTo(x + bounds.height * 0.52, bounds.y + bounds.height);
      context.stroke();
      context.beginPath();
      context.moveTo(x, bounds.y);
      context.lineTo(x - bounds.height * 0.52, bounds.y + bounds.height);
      context.stroke();
    }

    context.globalAlpha = 0.32;
    context.fillStyle = shade(state.tone, -44);
    for (let y = bounds.y + spacing; y < bounds.y + bounds.height; y += spacing) {
      for (let x = bounds.x + spacing; x < bounds.x + bounds.width; x += spacing) {
        context.beginPath();
        context.arc(x + ((y / spacing) % 2) * spacing * 0.5, y, 1.3, 0, Math.PI * 2);
        context.fill();
      }
    }
    context.restore();
  }

  function strokeSeam(pathBuilder, width = 2.2) {
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "rgba(0,0,0,.34)";
    context.lineWidth = width + 2;
    pathBuilder();
    context.stroke();
    context.strokeStyle = "rgba(255,255,255,.28)";
    context.lineWidth = width;
    pathBuilder();
    context.stroke();
    context.restore();
  }

  function drawEyelet(x, y, radius = 6) {
    context.save();
    context.fillStyle = "rgba(0,0,0,.42)";
    context.beginPath();
    context.ellipse(x, y + 1, radius, radius * 0.72, 0, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "rgba(255,255,255,.34)";
    context.lineWidth = Math.max(1.2, radius * 0.24);
    context.beginPath();
    context.ellipse(x, y, radius, radius * 0.72, 0, 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = shade(state.tone, -54);
    context.beginPath();
    context.ellipse(x, y, radius * 0.38, radius * 0.3, 0, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  function drawPerforations(points, radius = 2.4) {
    context.save();
    context.fillStyle = "rgba(0,0,0,.36)";
    context.strokeStyle = "rgba(255,255,255,.16)";
    context.lineWidth = 0.8;
    points.forEach(({x, y}) => {
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    });
    context.restore();
  }

  function drawTopButton(x, y, width = 25) {
    context.save();
    context.shadowColor = "rgba(0,0,0,.35)";
    context.shadowBlur = 6;
    context.shadowOffsetY = 3;
    const button = context.createLinearGradient(x, y - 7, x, y + 8);
    button.addColorStop(0, shade(state.tone, 42));
    button.addColorStop(0.48, state.tone);
    button.addColorStop(1, shade(state.tone, -35));
    context.fillStyle = button;
    context.beginPath();
    context.ellipse(x, y, width, width * 0.37, 0, 0, Math.PI * 2);
    context.fill();
    context.shadowColor = "transparent";
    context.strokeStyle = "rgba(255,255,255,.3)";
    context.lineWidth = 1.5;
    context.stroke();
    context.restore();
  }

  function drawRope(pathBuilder) {
    context.save();
    context.lineCap = "round";
    context.strokeStyle = "rgba(0,0,0,.45)";
    context.lineWidth = 13;
    pathBuilder();
    context.stroke();
    context.strokeStyle = "#d89508";
    context.lineWidth = 10;
    pathBuilder();
    context.stroke();
    context.strokeStyle = "#ffd45c";
    context.lineWidth = 3;
    pathBuilder();
    context.stroke();
    context.strokeStyle = "rgba(76,45,0,.55)";
    context.lineWidth = 2;
    context.setLineDash([2, 8]);
    pathBuilder();
    context.stroke();
    context.setLineDash([]);
    context.restore();
  }

  function frontCrownPath(top, base) {
    context.beginPath();
    context.moveTo(223, base);
    context.bezierCurveTo(224, 391, 260, 266, 364, top + 25);
    context.bezierCurveTo(407, top + 3, 457, top, 500, top);
    context.bezierCurveTo(543, top, 593, top + 3, 636, top + 25);
    context.bezierCurveTo(740, 266, 776, 391, 777, base);
    context.bezierCurveTo(661, 555, 339, 555, 223, base);
    context.closePath();
  }

  function drawFrontHat() {
    const geometry = profileGeometry();
    const {top, base} = geometry;

    drawContactShadow(500, 628, 390, 74, 0.28);

    const crown = context.createLinearGradient(224, top, 780, base);
    crown.addColorStop(0, shade(state.tone, 35));
    crown.addColorStop(0.28, shade(state.tone, 12));
    crown.addColorStop(0.58, state.tone);
    crown.addColorStop(1, shade(state.tone, -38));
    context.fillStyle = crown;
    frontCrownPath(top, base);
    context.fill();
    context.strokeStyle = "rgba(0,0,0,.55)";
    context.lineWidth = 3;
    context.stroke();

    context.save();
    frontCrownPath(top, base);
    context.clip();
    const crownLight = context.createRadialGradient(430, top + 72, 20, 470, top + 155, 310);
    crownLight.addColorStop(0, "rgba(255,255,255,.24)");
    crownLight.addColorStop(0.55, "rgba(255,255,255,.04)");
    crownLight.addColorStop(1, "rgba(0,0,0,.28)");
    context.fillStyle = crownLight;
    context.fillRect(190, top - 10, 620, base - top + 60);

    context.fillStyle = "rgba(0,0,0,.12)";
    context.beginPath();
    context.moveTo(223, base);
    context.bezierCurveTo(225, 360, 286, 244, 391, top + 9);
    context.quadraticCurveTo(332, 351, 345, 546);
    context.quadraticCurveTo(273, 542, 223, base);
    context.fill();
    context.beginPath();
    context.moveTo(777, base);
    context.bezierCurveTo(775, 360, 714, 244, 609, top + 9);
    context.quadraticCurveTo(668, 351, 655, 546);
    context.quadraticCurveTo(727, 542, 777, base);
    context.fill();
    context.restore();

    drawFabricTexture(() => frontCrownPath(top, base), {x: 215, y: top, width: 570, height: base - top + 32});

    if (geometry.mesh) {
      const leftMesh = () => {
        context.beginPath();
        context.moveTo(223, base);
        context.bezierCurveTo(224, 391, 260, 266, 364, top + 25);
        context.quadraticCurveTo(319, 354, 345, 548);
        context.quadraticCurveTo(268, 540, 223, base);
        context.closePath();
      };
      const rightMesh = () => {
        context.beginPath();
        context.moveTo(777, base);
        context.bezierCurveTo(776, 391, 740, 266, 636, top + 25);
        context.quadraticCurveTo(681, 354, 655, 548);
        context.quadraticCurveTo(732, 540, 777, base);
        context.closePath();
      };
      drawMesh(leftMesh, {x: 210, y: top + 16, width: 170, height: base - top + 30}, 15);
      drawMesh(rightMesh, {x: 620, y: top + 16, width: 170, height: base - top + 30}, 15);
    }

    strokeSeam(() => {
      context.beginPath();
      context.moveTo(500, top + 2);
      context.bezierCurveTo(480, 287, 483, 414, 500, 546);
    }, 2.5);
    strokeSeam(() => {
      context.beginPath();
      context.moveTo(499, top + 3);
      context.bezierCurveTo(404, 254, 357, 387, 345, 544);
    }, 1.6);
    strokeSeam(() => {
      context.beginPath();
      context.moveTo(501, top + 3);
      context.bezierCurveTo(596, 254, 643, 387, 655, 544);
    }, 1.6);

    if (!geometry.mesh) {
      drawEyelet(345, top + 135, 5.6);
      drawEyelet(655, top + 135, 5.6);
    }
    if (geometry.perforated) {
      const holes = [];
      [307, 326, 345, 655, 674, 693].forEach((x, index) => {
        holes.push({x, y: top + 182 + (index % 3) * 12});
        holes.push({x, y: top + 213 + (index % 3) * 9});
      });
      drawPerforations(holes, 2.2);
    }
    if (geometry.soft) {
      strokeSeam(() => {
        context.beginPath();
        context.moveTo(420, top + 42);
        context.quadraticCurveTo(447, top + 75, 430, top + 114);
      }, 1);
      strokeSeam(() => {
        context.beginPath();
        context.moveTo(579, top + 42);
        context.quadraticCurveTo(551, top + 76, 568, top + 116);
      }, 1);
    }
    drawTopButton(500, top + 1, geometry.soft ? 20 : 24);

    const billTop = context.createLinearGradient(500, base - 30, 500, 666);
    billTop.addColorStop(0, shade(state.tone, 26));
    billTop.addColorStop(0.44, state.tone);
    billTop.addColorStop(1, shade(state.tone, -34));

    context.fillStyle = shade(state.tone, -48);
    context.beginPath();
    if (geometry.flatBill) {
      context.moveTo(247, base - 18);
      context.lineTo(753, base - 18);
      context.lineTo(860, 581);
      context.quadraticCurveTo(500, 637, 140, 581);
    } else {
      context.moveTo(242, base - 21);
      context.bezierCurveTo(355, base + 12, 645, base + 12, 758, base - 21);
      context.bezierCurveTo(815, 537, 830, 595, 771, 638);
      context.bezierCurveTo(631, 704, 363, 704, 226, 638);
      context.bezierCurveTo(170, 611, 180, 548, 242, base - 21);
    }
    context.closePath();
    context.fill();

    context.fillStyle = billTop;
    context.beginPath();
    if (geometry.flatBill) {
      context.moveTo(247, base - 26);
      context.lineTo(753, base - 26);
      context.lineTo(848, 561);
      context.quadraticCurveTo(500, 611, 152, 561);
    } else {
      context.moveTo(242, base - 28);
      context.bezierCurveTo(354, base + 1, 646, base + 1, 758, base - 28);
      context.bezierCurveTo(803, 524, 813, 567, 759, 607);
      context.bezierCurveTo(621, 668, 379, 668, 241, 607);
      context.bezierCurveTo(187, 583, 197, 532, 242, base - 28);
    }
    context.closePath();
    context.fill();
    context.strokeStyle = "rgba(0,0,0,.56)";
    context.lineWidth = 3;
    context.stroke();

    context.save();
    context.strokeStyle = "rgba(255,255,255,.25)";
    context.lineWidth = 2;
    for (let inset = 0; inset < 3; inset += 1) {
      context.beginPath();
      if (geometry.flatBill) {
        context.moveTo(220 + inset * 22, 552 + inset * 10);
        context.quadraticCurveTo(500, 588 - inset * 7, 780 - inset * 22, 552 + inset * 10);
      } else {
        context.moveTo(221 + inset * 17, 574 + inset * 13);
        context.quadraticCurveTo(500, 654 - inset * 22, 779 - inset * 17, 574 + inset * 13);
      }
      context.stroke();
    }
    context.restore();

    context.strokeStyle = "rgba(255,255,255,.33)";
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(249, base - 27);
    context.bezierCurveTo(361, base + 2, 639, base + 2, 751, base - 27);
    context.stroke();

    if (geometry.rope) {
      drawRope(() => {
        context.beginPath();
        context.moveTo(249, base - 26);
        context.bezierCurveTo(367, base + 7, 633, base + 7, 751, base - 26);
      });
    }
  }

  function sideCrownPath(top, base) {
    context.beginPath();
    context.moveTo(204, base);
    context.bezierCurveTo(210, 374, 253, 273, 353, top + 38);
    context.bezierCurveTo(407, top + 11, 498, top - 7, 560, top + 5);
    context.bezierCurveTo(676, top + 30, 752, 310, 767, base - 18);
    context.bezierCurveTo(643, 556, 363, 562, 204, base);
    context.closePath();
  }

  function drawSideHat(direction) {
    const geometry = profileGeometry();
    const mirrored = direction === "right";
    const {top, base} = geometry;
    context.save();
    if (mirrored) {
      context.translate(canvas.width, 0);
      context.scale(-1, 1);
    }

    drawContactShadow(552, 628, 402, 69, 0.28);

    const side = context.createLinearGradient(207, top, 776, base);
    side.addColorStop(0, shade(state.tone, 25));
    side.addColorStop(0.34, shade(state.tone, 12));
    side.addColorStop(0.7, state.tone);
    side.addColorStop(1, shade(state.tone, -38));
    context.fillStyle = side;
    sideCrownPath(top, base);
    context.fill();
    context.strokeStyle = "rgba(0,0,0,.58)";
    context.lineWidth = 3;
    context.stroke();

    context.save();
    sideCrownPath(top, base);
    context.clip();
    const highlight = context.createRadialGradient(455, top + 65, 14, 488, top + 130, 330);
    highlight.addColorStop(0, "rgba(255,255,255,.24)");
    highlight.addColorStop(0.55, "rgba(255,255,255,.03)");
    highlight.addColorStop(1, "rgba(0,0,0,.31)");
    context.fillStyle = highlight;
    context.fillRect(180, top - 20, 620, base - top + 80);

    const frontPanelShade = context.createLinearGradient(510, 0, 775, 0);
    frontPanelShade.addColorStop(0, "rgba(255,255,255,.045)");
    frontPanelShade.addColorStop(1, "rgba(0,0,0,.22)");
    context.fillStyle = frontPanelShade;
    context.beginPath();
    context.moveTo(554, top + 5);
    context.bezierCurveTo(676, top + 30, 752, 310, 767, base - 18);
    context.quadraticCurveTo(650, 548, 507, 551);
    context.quadraticCurveTo(530, 349, 554, top + 5);
    context.fill();
    context.restore();

    drawFabricTexture(() => sideCrownPath(top, base), {x: 198, y: top, width: 580, height: base - top + 40});

    if (geometry.mesh) {
      const rearMesh = () => {
        context.beginPath();
        context.moveTo(204, base);
        context.bezierCurveTo(210, 374, 253, 273, 353, top + 38);
        context.bezierCurveTo(410, top + 12, 498, top - 7, 554, top + 5);
        context.quadraticCurveTo(516, 332, 507, 550);
        context.quadraticCurveTo(332, 553, 204, base);
        context.closePath();
      };
      drawMesh(rearMesh, {x: 195, y: top - 4, width: 375, height: base - top + 50}, 16);
    }

    strokeSeam(() => {
      context.beginPath();
      context.moveTo(553, top + 4);
      context.bezierCurveTo(520, 320, 505, 430, 507, 549);
    }, 2.4);
    strokeSeam(() => {
      context.beginPath();
      context.moveTo(553, top + 4);
      context.bezierCurveTo(638, 240, 704, 360, 735, 513);
    }, 1.5);
    strokeSeam(() => {
      context.beginPath();
      context.moveTo(552, top + 4);
      context.bezierCurveTo(435, 244, 325, 365, 279, 540);
    }, 1.35);

    if (!geometry.mesh) {
      drawEyelet(397, top + 137, 5.4);
      drawEyelet(650, top + 153, 5.2);
    }
    if (geometry.perforated) {
      const holes = [];
      for (let row = 0; row < 3; row += 1) {
        for (let column = 0; column < 5; column += 1) {
          holes.push({x: 300 + column * 24 + row * 5, y: top + 191 + row * 22});
        }
      }
      drawPerforations(holes, 2.3);
    }
    if (geometry.soft) {
      strokeSeam(() => {
        context.beginPath();
        context.moveTo(590, top + 30);
        context.quadraticCurveTo(613, top + 76, 594, top + 118);
      }, 1);
    }
    drawTopButton(553, top + 2, geometry.soft ? 20 : 24);

    const billTop = context.createLinearGradient(730, base - 30, 836, 612);
    billTop.addColorStop(0, shade(state.tone, 29));
    billTop.addColorStop(0.55, state.tone);
    billTop.addColorStop(1, shade(state.tone, -38));

    context.fillStyle = shade(state.tone, -50);
    context.beginPath();
    if (geometry.flatBill) {
      context.moveTo(652, base - 28);
      context.lineTo(774, base - 7);
      context.lineTo(956, 555);
      context.lineTo(927, 616);
      context.lineTo(676, 585);
    } else {
      context.moveTo(649, base - 25);
      context.bezierCurveTo(697, base - 15, 742, base - 4, 773, base + 10);
      context.bezierCurveTo(839, 528, 917, 548, 958, 578);
      context.bezierCurveTo(924, 618, 828, 636, 700, 596);
      context.bezierCurveTo(666, 585, 645, 548, 649, base - 25);
    }
    context.closePath();
    context.fill();

    context.fillStyle = billTop;
    context.beginPath();
    if (geometry.flatBill) {
      context.moveTo(652, base - 36);
      context.lineTo(774, base - 15);
      context.lineTo(948, 546);
      context.lineTo(920, 593);
      context.lineTo(682, 566);
    } else {
      context.moveTo(649, base - 34);
      context.bezierCurveTo(700, base - 23, 744, base - 12, 775, base + 2);
      context.bezierCurveTo(841, 520, 913, 540, 950, 566);
      context.bezierCurveTo(909, 596, 828, 611, 708, 575);
      context.bezierCurveTo(674, 565, 651, 535, 649, base - 34);
    }
    context.closePath();
    context.fill();
    context.strokeStyle = "rgba(0,0,0,.58)";
    context.lineWidth = 3;
    context.stroke();

    context.strokeStyle = "rgba(255,255,255,.28)";
    context.lineWidth = 2;
    for (let inset = 0; inset < 3; inset += 1) {
      context.beginPath();
      if (geometry.flatBill) {
        context.moveTo(685 + inset * 13, 546 + inset * 10);
        context.quadraticCurveTo(820, 567 + inset * 7, 927 - inset * 8, 559 + inset * 9);
      } else {
        context.moveTo(689 + inset * 11, 545 + inset * 10);
        context.quadraticCurveTo(820, 594 + inset * 2, 925 - inset * 10, 563 + inset * 10);
      }
      context.stroke();
    }

    context.strokeStyle = "rgba(255,255,255,.3)";
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(654, base - 34);
    context.bezierCurveTo(704, base - 23, 744, base - 12, 775, base + 2);
    context.stroke();

    if (geometry.rope) {
      drawRope(() => {
        context.beginPath();
        context.moveTo(565, base - 16);
        context.quadraticCurveTo(665, base + 2, 762, base - 9);
      });
    }

    context.restore();
  }

  function backCrownPath(top, base) {
    context.beginPath();
    context.moveTo(216, base);
    context.bezierCurveTo(220, 374, 272, 256, 378, top + 19);
    context.bezierCurveTo(419, top + 2, 461, top, 500, top);
    context.bezierCurveTo(539, top, 581, top + 2, 622, top + 19);
    context.bezierCurveTo(728, 256, 780, 374, 784, base);
    context.bezierCurveTo(655, 563, 345, 563, 216, base);
    context.closePath();
  }

  function drawBackHat() {
    const geometry = profileGeometry();
    const {top, base} = geometry;
    drawContactShadow(500, 625, 360, 68, 0.27);

    const brimPeek = context.createLinearGradient(500, base - 2, 500, 622);
    brimPeek.addColorStop(0, shade(state.tone, 2));
    brimPeek.addColorStop(1, shade(state.tone, -48));
    context.fillStyle = brimPeek;
    context.beginPath();
    context.moveTo(266, base - 9);
    context.bezierCurveTo(366, base + 15, 634, base + 15, 734, base - 9);
    context.bezierCurveTo(760, 542, 731, 585, 674, 610);
    context.bezierCurveTo(568, 643, 432, 643, 326, 610);
    context.bezierCurveTo(269, 585, 240, 542, 266, base - 9);
    context.closePath();
    context.fill();
    context.strokeStyle = "rgba(255,255,255,.15)";
    context.lineWidth = 2;
    context.stroke();

    const back = context.createLinearGradient(218, top, 786, base);
    back.addColorStop(0, shade(state.tone, 31));
    back.addColorStop(0.4, shade(state.tone, 10));
    back.addColorStop(0.65, state.tone);
    back.addColorStop(1, shade(state.tone, -38));
    context.fillStyle = back;
    backCrownPath(top, base);
    context.fill();
    context.strokeStyle = "rgba(0,0,0,.58)";
    context.lineWidth = 3;
    context.stroke();

    context.save();
    backCrownPath(top, base);
    context.clip();
    const backLight = context.createRadialGradient(410, top + 79, 18, 488, top + 160, 330);
    backLight.addColorStop(0, "rgba(255,255,255,.21)");
    backLight.addColorStop(0.58, "rgba(255,255,255,.025)");
    backLight.addColorStop(1, "rgba(0,0,0,.29)");
    context.fillStyle = backLight;
    context.fillRect(190, top - 10, 620, base - top + 80);
    context.restore();

    drawFabricTexture(() => backCrownPath(top, base), {x: 208, y: top, width: 584, height: base - top + 45});

    if (geometry.mesh) {
      drawMesh(
        () => backCrownPath(top, base),
        {x: 205, y: top, width: 590, height: base - top + 48},
        17
      );

      const centerTape = context.createLinearGradient(489, top, 511, top);
      centerTape.addColorStop(0, shade(state.tone, -30));
      centerTape.addColorStop(0.5, shade(state.tone, 20));
      centerTape.addColorStop(1, shade(state.tone, -30));
      context.fillStyle = centerTape;
      context.beginPath();
      context.moveTo(490, top + 4);
      context.lineTo(510, top + 4);
      context.lineTo(519, 443);
      context.lineTo(481, 443);
      context.closePath();
      context.fill();
    }

    strokeSeam(() => {
      context.beginPath();
      context.moveTo(500, top + 3);
      context.lineTo(500, 439);
    }, 2.4);
    strokeSeam(() => {
      context.beginPath();
      context.moveTo(500, top + 3);
      context.bezierCurveTo(398, 251, 320, 378, 286, 538);
    }, 1.6);
    strokeSeam(() => {
      context.beginPath();
      context.moveTo(500, top + 3);
      context.bezierCurveTo(602, 251, 680, 378, 714, 538);
    }, 1.6);

    if (!geometry.mesh) {
      drawEyelet(366, top + 139, 5.5);
      drawEyelet(634, top + 139, 5.5);
    }
    if (geometry.perforated) {
      const holes = [];
      for (let row = 0; row < 3; row += 1) {
        for (let column = 0; column < 7; column += 1) {
          holes.push({x: 326 + column * 58, y: top + 190 + row * 23 + (column % 2) * 4});
        }
      }
      drawPerforations(holes, 2.2);
    }
    drawTopButton(500, top + 1, geometry.soft ? 20 : 24);

    context.strokeStyle = "rgba(0,0,0,.52)";
    context.lineWidth = 11;
    context.beginPath();
    context.moveTo(235, base + 1);
    context.quadraticCurveTo(500, 572, 765, base + 1);
    context.stroke();
    context.strokeStyle = "rgba(255,255,255,.18)";
    context.lineWidth = 2;
    context.stroke();

    const opening = context.createLinearGradient(500, 429, 500, 569);
    opening.addColorStop(0, "rgba(0,0,0,.89)");
    opening.addColorStop(1, "rgba(0,0,0,.66)");
    context.fillStyle = opening;
    context.beginPath();
    context.moveTo(390, 558);
    context.lineTo(400, 508);
    context.bezierCurveTo(410, 456, 448, 429, 500, 429);
    context.bezierCurveTo(552, 429, 590, 456, 600, 508);
    context.lineTo(610, 558);
    context.quadraticCurveTo(500, 579, 390, 558);
    context.closePath();
    context.fill();
    context.strokeStyle = "rgba(255,255,255,.27)";
    context.lineWidth = 3;
    context.stroke();

    context.strokeStyle = rgbaTone(state.tone, 0.68);
    context.lineWidth = 9;
    context.beginPath();
    context.moveTo(404, 510);
    context.bezierCurveTo(414, 461, 451, 439, 500, 439);
    context.bezierCurveTo(549, 439, 586, 461, 596, 510);
    context.stroke();

    const closure = context.createLinearGradient(410, 531, 590, 566);
    closure.addColorStop(0, shade(state.tone, 26));
    closure.addColorStop(0.55, state.tone);
    closure.addColorStop(1, shade(state.tone, -30));
    context.fillStyle = closure;
    context.shadowColor = "rgba(0,0,0,.35)";
    context.shadowBlur = 5;
    roundedRectPath(context, 407, 536, 186, 36, 9);
    context.fill();
    context.shadowColor = "transparent";
    context.strokeStyle = "rgba(255,255,255,.28)";
    context.lineWidth = 1.5;
    context.stroke();

    if (state.profile === "Dad Cap") {
      context.fillStyle = "#c89a3b";
      roundedRectPath(context, 467, 541, 66, 26, 4);
      context.fill();
      context.fillStyle = "#202020";
      roundedRectPath(context, 475, 547, 50, 14, 2);
      context.fill();
    } else {
      context.fillStyle = "#fbbf24";
      roundedRectPath(context, 469, 544, 62, 20, 5);
      context.fill();
      context.fillStyle = "rgba(17,17,17,.55)";
      for (let x = 478; x <= 522; x += 11) {
        context.beginPath();
        context.arc(x, 554, 2.1, 0, Math.PI * 2);
        context.fill();
      }
    }
  }

  function baseDecorationSize() {
    const sideView = state.activeView === "left" || state.activeView === "right";
    const isBack = state.activeView === "back";
    if (state.method === "Embroidery") {
      if (sideView) return {width: 175, height: 74};
      if (isBack) return {width: 190, height: 68};
      return {width: 275, height: 105};
    }
    if (state.shape === "circle") {
      const diameter = sideView ? 108 : isBack ? 110 : 148;
      return {width: diameter, height: diameter};
    }
    if (sideView) return {width: 168, height: 92};
    if (isBack) return {width: 184, height: 82};
    return {width: 252, height: 132};
  }

  function decorationBounds() {
    const base = baseDecorationSize();
    const width = base.width * state.decorationScale;
    const height = base.height * state.decorationScale;
    const offset = state.offsets[state.activeView];
    const center = {
      front: {x: 505, y: 353},
      left: {x: 420, y: 350},
      right: {x: 580, y: 350},
      back: {x: 500, y: 342}
    }[state.activeView];
    return {
      width,
      height,
      x: center.x - width / 2 + offset.x,
      y: center.y - height / 2 + offset.y
    };
  }

  function drawArtwork(bounds, textColor) {
    if (state.logo) {
      const scale = Math.min(
        (bounds.width * 0.76) / state.logo.width,
        (bounds.height * 0.68) / state.logo.height
      ) * state.logoScale;
      const width = state.logo.width * scale;
      const height = state.logo.height * scale;
      context.drawImage(
        state.logo,
        bounds.x + (bounds.width - width) / 2,
        bounds.y + (bounds.height - height) / 2,
        width,
        height
      );
      return;
    }

    const label = state.text || "YOUR LOGO";
    const fontSize = Math.min(
      bounds.height * 0.42,
      Math.max(15, (bounds.width / Math.max(label.length, 5)) * 1.5)
    );
    context.fillStyle = textColor;
    context.strokeStyle = state.method === "Embroidery" ? "rgba(5,5,5,.48)" : "transparent";
    context.lineWidth = 1;
    context.font = `900 ${fontSize}px "Barlow Condensed", Impact, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    if (state.method === "Embroidery") {
      context.strokeText(label, bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, bounds.width * 0.86);
    }
    context.fillText(label, bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, bounds.width * 0.86);
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
  }

  function drawDecoration() {
    const bounds = decorationBounds();
    context.save();
    context.translate(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    context.rotate(state.rotation * Math.PI / 180);
    context.translate(-(bounds.x + bounds.width / 2), -(bounds.y + bounds.height / 2));

    if (state.method === "Embroidery") {
      context.shadowColor = "rgba(0,0,0,.28)";
      context.shadowBlur = 2;
      context.shadowOffsetY = 1;
      drawArtwork(bounds, contrastColor(state.tone) === "#111111" ? "#151515" : "#fbbf24");
      context.shadowColor = "transparent";
      context.strokeStyle = "rgba(251,191,36,.6)";
      context.lineWidth = 1;
      context.setLineDash([3, 4]);
      roundedRectPath(context, bounds.x + 2, bounds.y + 2, bounds.width - 4, bounds.height - 4, 7);
      context.stroke();
      context.setLineDash([]);
    } else {
      patchPath(context, bounds.x, bounds.y, bounds.width, bounds.height);
      const patchFill = context.createLinearGradient(bounds.x, bounds.y, bounds.x, bounds.y + bounds.height);
      if (state.method === "Leather Patch") {
        patchFill.addColorStop(0, "#b6804f");
        patchFill.addColorStop(1, "#684126");
      } else {
        patchFill.addColorStop(0, "#ffffff");
        patchFill.addColorStop(1, "#dcd9d1");
      }
      context.fillStyle = patchFill;
      context.shadowColor = "rgba(0,0,0,.3)";
      context.shadowBlur = 12;
      context.shadowOffsetY = 6;
      context.fill();
      context.shadowColor = "transparent";

      context.save();
      patchPath(context, bounds.x, bounds.y, bounds.width, bounds.height);
      context.clip();
      if (state.method === "Leather Patch") {
        context.globalAlpha = 0.16;
        context.strokeStyle = "#fff";
        for (let y = bounds.y; y < bounds.y + bounds.height; y += 8) {
          context.beginPath();
          context.moveTo(bounds.x, y);
          context.quadraticCurveTo(bounds.x + bounds.width / 2, y + 5, bounds.x + bounds.width, y);
          context.stroke();
        }
        context.globalAlpha = 1;
      } else {
        context.fillStyle = "#00a9e8";
        context.fillRect(bounds.x, bounds.y, bounds.width * 0.025, bounds.height);
        context.fillStyle = "#ec2f8d";
        context.fillRect(bounds.x + bounds.width * 0.025, bounds.y, bounds.width * 0.025, bounds.height);
        context.fillStyle = "#f2cc16";
        context.fillRect(bounds.x + bounds.width * 0.05, bounds.y, bounds.width * 0.025, bounds.height);
      }
      drawArtwork(bounds, state.method === "Leather Patch" ? "#f8eedf" : "#111111");
      context.restore();

      context.strokeStyle = state.method === "Leather Patch" ? "rgba(255,255,255,.5)" : "rgba(17,17,17,.28)";
      context.lineWidth = 2;
      context.setLineDash([5, 5]);
      const inset = 7;
      patchPath(context, bounds.x + inset, bounds.y + inset, bounds.width - inset * 2, bounds.height - inset * 2);
      context.stroke();
      context.setLineDash([]);
    }

    context.restore();

    if (!state.placements.has(state.activeView)) {
      context.fillStyle = "rgba(5,5,5,.82)";
      roundedRectPath(context, 330, 640, 340, 34, 4);
      context.fill();
      context.fillStyle = "#fbbf24";
      context.font = '800 12px "Inter", Arial, sans-serif';
      context.textAlign = "center";
      context.fillText(`PREVIEW ONLY • ADD ${viewNames[state.activeView].toUpperCase()} TO THE QUOTE`, 500, 662);
      context.textAlign = "left";
    }
  }

  function placementList() {
    return [...state.placements].map((placement) => viewNames[placement]).join(", ") || "None selected";
  }

  function formValue(name) {
    const field = form.elements.namedItem(name);
    if (!field || typeof field.value !== "string") return "";
    return field.value.trim();
  }

  function buildSettings() {
    return {
      reference,
      inventoryItemId: inventoryIdInput.value || null,
      brand: state.brand,
      profile: state.profile,
      model: state.model || "Not specified",
      previewColor: state.toneName,
      decorationMethod: state.method,
      patchShape: state.method === "Embroidery" ? "Not applicable" : state.shape,
      placements: [...state.placements].map((placement) => viewNames[placement]),
      activePreview: viewNames[state.activeView],
      decorationScale: Math.round(state.decorationScale * 100),
      decorationRotation: state.rotation,
      artworkScale: Math.round(state.logoScale * 100),
      offsets: state.offsets
    };
  }

  function buildSummaryText() {
    const model = state.model ? ` • ${state.model}` : "";
    const requestedColor = formValue("preferred_hat_color");
    const artwork = logoInput.files[0]?.name || "No artwork file selected";
    return [
      `T-Designs quote packet ${reference}`,
      inventoryIdInput.value ? `Inventory item: ${inventoryIdInput.value}` : null,
      `Hat: ${state.brand} • ${state.profile}${model}`,
      `Preview color: ${state.toneName}`,
      requestedColor ? `Exact color request: ${requestedColor}` : null,
      `Decoration: ${state.method}`,
      `Placements: ${placementList()}`,
      state.method === "Embroidery" ? null : `Patch shape: ${state.shape}`,
      `Preview text: ${state.text || "Artwork uploaded"}`,
      `Artwork file: ${artwork}`,
      `Decoration size: ${Math.round(state.decorationScale * 100)}%`,
      `Decoration angle: ${state.rotation}°`,
      `Artwork size: ${Math.round(state.logoScale * 100)}%`,
      "",
      "Customer details",
      `Name: ${formValue("name") || "Not entered"}`,
      `Email: ${formValue("email") || "Not entered"}`,
      `Phone: ${formValue("phone") || "Not entered"}`,
      `Business / team: ${formValue("organization") || "Not entered"}`,
      `Estimated quantity: ${formValue("quantity") || "Not entered"}`,
      `Needed by: ${formValue("needed_by") || "Not entered"}`,
      `Project notes: ${formValue("notes") || "None"}`
    ].filter((value) => value !== null).join("\n");
  }

  function drawHat() {
    settingsInput.value = JSON.stringify(buildSettings());
    context.clearRect(0, 0, canvas.width, canvas.height);
    drawBackground();

    if (state.activeView === "front") drawFrontHat();
    if (state.activeView === "left") drawSideHat("left");
    if (state.activeView === "right") drawSideHat("right");
    if (state.activeView === "back") drawBackHat();

    drawDecoration();

    const model = state.model ? ` • ${state.model}` : "";
    summaryHat.textContent = `${state.brand} • ${state.profile}${model}`;
    summaryMethod.textContent = state.method;
    summaryView.textContent = viewNames[state.activeView];
  }

  function enforcePlacementRules() {
    const embroidery = state.method === "Embroidery";

    placementChecks.forEach((checkbox) => {
      const placement = checkbox.dataset.placementCheck;
      const front = placement === "front";
      checkbox.disabled = !embroidery && !front;
      checkbox.closest("label")?.classList.toggle("is-disabled", checkbox.disabled);
      if (checkbox.disabled) {
        checkbox.checked = false;
        state.placements.delete(placement);
      }
    });

    viewButtons.forEach((button) => {
      const front = button.dataset.viewButton === "front";
      button.disabled = !embroidery && !front;
    });

    if (!embroidery) {
      const frontCheckbox = placementChecks.find((checkbox) => checkbox.dataset.placementCheck === "front");
      if (frontCheckbox) frontCheckbox.checked = true;
      state.placements = new Set(["front"]);
      state.activeView = "front";
    }

    placementCopy.textContent = embroidery
      ? "Embroidery can use one location or combine multiple areas. Use the view buttons on the mockup to inspect each selection."
      : "Leather and UV-printed patch mockups begin on the front. Ask T-Designs to confirm any other patch location during quoting.";

    viewButtons.forEach((button) => {
      const active = button.dataset.viewButton === state.activeView;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function setMethod(method) {
    const input = form.querySelector(`input[name="decoration_method"][value="${CSS.escape(method)}"]`);
    if (!input) return;
    input.checked = true;
    state.method = method;
    patchOptions.hidden = method === "Embroidery";
    enforcePlacementRules();
    drawHat();
  }

  document.querySelectorAll("[data-method-link]").forEach((link) => {
    link.addEventListener("click", () => setMethod(link.dataset.methodLink));
  });

  document.querySelectorAll("[data-brand-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.dataset.brandChoice;
      if ([...brandSelect.options].some((option) => option.value === value)) {
        brandSelect.value = value;
        brandSelect.dispatchEvent(new Event("change", {bubbles: true}));
      }
      document.querySelector("#studio")?.scrollIntoView({behavior: "smooth"});
      window.setTimeout(() => brandSelect.focus({preventScroll: true}), 500);
    });
  });

  form.addEventListener("change", (event) => {
    const target = event.target;
    if (target === brandSelect) {
      state.brand = target.value;
      inventoryIdInput.value = "";
    }
    if (target === profileSelect) {
      state.profile = target.value;
      inventoryIdInput.value = "";
    }
    if (target.name === "preview_color") {
      state.tone = target.dataset.color;
      state.toneName = target.value;
      inventoryIdInput.value = "";
    }
    if (target.name === "decoration_method") {
      state.method = target.value;
      patchOptions.hidden = target.value === "Embroidery";
      enforcePlacementRules();
    }
    if (target === shapeSelect) state.shape = target.value;
    if (target.matches("[data-placement-check]")) {
      const placement = target.dataset.placementCheck;
      if (target.checked) {
        state.placements.add(placement);
        state.activeView = placement;
      } else {
        state.placements.delete(placement);
      }
      viewButtons.forEach((button) => {
        const active = button.dataset.viewButton === state.activeView;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });
    }
    drawHat();
  });

  modelInput.addEventListener("input", () => {
    state.model = modelInput.value.trim();
    inventoryIdInput.value = "";
    drawHat();
  });

  preferredColorInput.addEventListener("input", () => {
    inventoryIdInput.value = "";
  });

  previewText.addEventListener("input", () => {
    state.text = previewText.value.toUpperCase();
    drawHat();
  });

  viewButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.activeView = button.dataset.viewButton;
      viewButtons.forEach((candidate) => {
        const active = candidate === button;
        candidate.classList.toggle("is-active", active);
        candidate.setAttribute("aria-pressed", String(active));
      });
      drawHat();
    });
  });

  sizeControl.addEventListener("input", () => {
    state.decorationScale = Number(sizeControl.value) / 100;
    sizeOutput.textContent = `${sizeControl.value}%`;
    drawHat();
  });

  rotationControl.addEventListener("input", () => {
    state.rotation = Number(rotationControl.value);
    rotationOutput.textContent = `${rotationControl.value}°`;
    drawHat();
  });

  logoSizeControl.addEventListener("input", () => {
    state.logoScale = Number(logoSizeControl.value) / 100;
    logoSizeOutput.textContent = `${logoSizeControl.value}%`;
    drawHat();
  });

  resetButton.addEventListener("click", () => {
    state.decorationScale = 1;
    state.rotation = 0;
    state.logoScale = 1;
    Object.keys(state.offsets).forEach((view) => {
      state.offsets[view] = {x: 0, y: 0};
    });
    sizeControl.value = "100";
    rotationControl.value = "0";
    logoSizeControl.value = "100";
    sizeOutput.textContent = "100%";
    rotationOutput.textContent = "0°";
    logoSizeOutput.textContent = "100%";
    toolFeedback.textContent = "Decoration controls and all view positions reset.";
    drawHat();
  });

  let draggingDecoration = false;
  let lastPointer = null;

  function canvasPoint(event) {
    const bounds = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * (canvas.width / bounds.width),
      y: (event.clientY - bounds.top) * (canvas.height / bounds.height)
    };
  }

  canvas.addEventListener("pointerdown", (event) => {
    const point = canvasPoint(event);
    const bounds = decorationBounds();
    const padding = 28;
    const inside = point.x >= bounds.x - padding
      && point.x <= bounds.x + bounds.width + padding
      && point.y >= bounds.y - padding
      && point.y <= bounds.y + bounds.height + padding;
    if (!inside) return;
    draggingDecoration = true;
    lastPointer = point;
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!draggingDecoration || !lastPointer) return;
    const point = canvasPoint(event);
    const offset = state.offsets[state.activeView];
    offset.x = Math.max(-180, Math.min(180, offset.x + point.x - lastPointer.x));
    offset.y = Math.max(-105, Math.min(105, offset.y + point.y - lastPointer.y));
    lastPointer = point;
    drawHat();
  });

  function stopDragging(event) {
    draggingDecoration = false;
    lastPointer = null;
    if (event.pointerId !== undefined && canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  }

  canvas.addEventListener("pointerup", stopDragging);
  canvas.addEventListener("pointercancel", stopDragging);

  function moveDecoration(x, y, amount = 6) {
    const offset = state.offsets[state.activeView];
    offset.x = Math.max(-180, Math.min(180, offset.x + x * amount));
    offset.y = Math.max(-105, Math.min(105, offset.y + y * amount));
    drawHat();
  }

  canvas.addEventListener("keydown", (event) => {
    const moves = {
      ArrowLeft: {x: -1, y: 0},
      ArrowRight: {x: 1, y: 0},
      ArrowUp: {x: 0, y: -1},
      ArrowDown: {x: 0, y: 1}
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    moveDecoration(move.x, move.y, event.shiftKey ? 15 : 5);
  });

  nudgeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      moveDecoration(Number(button.dataset.nudgeX), Number(button.dataset.nudgeY));
      canvas.focus({preventScroll: true});
    });
  });

  function clearArtworkSelection() {
    logoInput.value = "";
    state.logo = null;
    uploadName.textContent = "";
    uploadStatus.hidden = true;
  }

  logoInput.addEventListener("change", () => {
    const file = logoInput.files[0];
    if (!file) return;

    if (file.size > 8 * 1024 * 1024) {
      clearArtworkSelection();
      drawHat();
      window.alert("Please choose artwork smaller than 8 MB.");
      return;
    }

    const extension = file.name.split(".").pop().toLowerCase();
    if (!["png", "jpg", "jpeg", "webp", "svg", "pdf"].includes(extension)) {
      clearArtworkSelection();
      drawHat();
      window.alert("Please upload a PNG, JPG, WebP, SVG, or PDF file.");
      return;
    }

    state.logo = null;
    uploadStatus.hidden = true;

    if (extension === "pdf") {
      state.logo = null;
      uploadName.textContent = `${file.name} (included with request; text preview shown)`;
      uploadStatus.hidden = false;
      drawHat();
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        state.logo = image;
        uploadName.textContent = file.name;
        uploadStatus.hidden = false;
        drawHat();
      };
      image.onerror = () => {
        state.logo = null;
        uploadName.textContent = `${file.name} (included with request; text preview shown)`;
        uploadStatus.hidden = false;
        drawHat();
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  removeLogo.addEventListener("click", () => {
    clearArtworkSelection();
    drawHat();
  });

  function createQuoteSheet() {
    const orderedViews = ["front", "left", "right", "back"];
    const selectedViews = orderedViews.filter((view) => state.placements.has(view));
    const views = selectedViews.length ? selectedViews : [state.activeView];
    const columns = views.length === 1 ? 1 : 2;
    const rows = Math.ceil(views.length / columns);
    const sheet = document.createElement("canvas");
    const sheetContext = sheet.getContext("2d");
    const originalView = state.activeView;

    sheet.width = canvas.width * columns;
    sheet.height = canvas.height * rows;
    sheetContext.fillStyle = "#050505";
    sheetContext.fillRect(0, 0, sheet.width, sheet.height);

    views.forEach((view, index) => {
      state.activeView = view;
      drawHat();
      const x = (index % columns) * canvas.width;
      const y = Math.floor(index / columns) * canvas.height;
      sheetContext.drawImage(canvas, x, y);
    });

    state.activeView = originalView;
    drawHat();
    return sheet;
  }

  downloadButton.addEventListener("click", () => {
    const link = document.createElement("a");
    const brand = state.brand.replaceAll(/[^a-z0-9]+/gi, "-").replaceAll(/^-|-$/g, "");
    const quoteSheet = createQuoteSheet();
    link.download = `${reference}-${brand || "hat"}-quote-sheet.png`;
    link.href = quoteSheet.toDataURL("image/png");
    link.click();
    toolFeedback.textContent = `${state.placements.size || 1}-view quote sheet downloaded.`;
  });

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  copyButton.addEventListener("click", async () => {
    try {
      await copyText(buildSummaryText());
      toolFeedback.textContent = "Complete quote packet copied.";
    } catch {
      toolFeedback.textContent = "Copy failed. Download the quote sheet instead.";
    }
  });

  quoteAppLink?.addEventListener("click", () => {
    copyText(buildSummaryText())
      .then(() => {
        toolFeedback.textContent = "Quote packet copied. Paste it into the quote app.";
      })
      .catch(() => {
        toolFeedback.textContent = "Quote app opened; copy the packet manually if needed.";
      });
  });

  form.addEventListener("submit", (event) => {
    if (form.dataset.mockupReady === "true") return;
    event.preventDefault();

    if (state.placements.size === 0) {
      window.alert("Choose at least one placement before sending the quote request.");
      return;
    }

    submitButton.disabled = true;
    submitButton.querySelector("span").textContent = "Preparing mockup…";

    const quoteSheet = createQuoteSheet();
    quoteSheet.toBlob((blob) => {
      if (blob && typeof DataTransfer !== "undefined") {
        const file = new File([blob], `${reference}-quote-sheet.png`, {type: "image/png"});
        const transfer = new DataTransfer();
        transfer.items.add(file);
        generatedFile.files = transfer.files;
      }

      form.dataset.mockupReady = "true";
      submitButton.querySelector("span").textContent = "Sending…";
      form.requestSubmit();
    }, "image/png");
  });

  drawHat();
})();
