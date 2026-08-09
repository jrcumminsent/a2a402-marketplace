const menuButton = document.querySelector('[data-menu-button]');
const mobileMenu = document.querySelector('[data-mobile-menu]');

if (menuButton && mobileMenu) {
  mobileMenu.setAttribute('aria-hidden', 'true');
  menuButton.addEventListener('click', () => {
    const open = menuButton.getAttribute('aria-expanded') === 'true';
    menuButton.setAttribute('aria-expanded', String(!open));
    mobileMenu.setAttribute('aria-hidden', String(open));
  });
  mobileMenu.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      menuButton.setAttribute('aria-expanded', 'false');
      mobileMenu.setAttribute('aria-hidden', 'true');
    });
  });
}

const form = document.querySelector('[data-mockup-form]');
const canvas = document.querySelector('[data-hat-canvas]');

if (form && canvas) {
  const context = canvas.getContext('2d');
  const logoInput = form.querySelector('[data-logo-input]');
  const previewText = form.querySelector('[data-preview-text]');
  const shapeSelect = form.querySelector('[data-shape-select]');
  const placementSelect = form.querySelector('[data-placement-select]');
  const uploadStatus = form.querySelector('[data-upload-status]');
  const uploadName = form.querySelector('[data-upload-name]');
  const removeLogo = form.querySelector('[data-remove-logo]');
  const generatedFile = form.querySelector('[data-generated-file]');
  const referenceInput = form.querySelector('[data-reference-input]');
  const settingsInput = form.querySelector('[data-settings-input]');
  const submitButton = form.querySelector('[data-submit-button]');
  const summaryModel = document.querySelector('[data-summary-model]');
  const summaryMaterial = document.querySelector('[data-summary-material]');
  const summaryReference = document.querySelector('[data-summary-reference]');
  const downloadButton = document.querySelector('[data-download-mockup]');
  const resetButton = document.querySelector('[data-reset-mockup]');
  const backgroundButton = document.querySelector('[data-background-toggle]');
  const sizeControl = document.querySelector('[data-size-control]');
  const rotationControl = document.querySelector('[data-rotation-control]');
  const logoSizeControl = document.querySelector('[data-logo-size-control]');
  const sizeOutput = document.querySelector('[data-size-output]');
  const rotationOutput = document.querySelector('[data-rotation-output]');
  const logoSizeOutput = document.querySelector('[data-logo-size-output]');

  const state = {
    model: 'Richardson 112',
    tone: '#202225',
    toneName: 'Black',
    material: 'Genuine Leather',
    shape: 'rounded',
    placement: 'center',
    text: 'YOUR LOGO',
    logo: null,
    patchScale: 1,
    patchRotation: 0,
    logoScale: 1,
    dragX: 0,
    dragY: 0,
    darkRoom: false
  };

  const reference = `FCC-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  referenceInput.value = reference;
  summaryReference.textContent = reference;

  function lighten(hex, amount) {
    const number = Number.parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, (number >> 16) + amount);
    const g = Math.min(255, ((number >> 8) & 255) + amount);
    const b = Math.min(255, (number & 255) + amount);
    return `rgb(${r},${g},${b})`;
  }

  function roundedRect(ctx, x, y, width, height, radius) {
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

  function hexPath(ctx, x, y, width, height) {
    const inset = width * .18;
    ctx.beginPath();
    ctx.moveTo(x + inset, y);
    ctx.lineTo(x + width - inset, y);
    ctx.lineTo(x + width, y + height / 2);
    ctx.lineTo(x + width - inset, y + height);
    ctx.lineTo(x + inset, y + height);
    ctx.lineTo(x, y + height / 2);
    ctx.closePath();
  }

  function patchDimensions() {
    const base = state.shape === 'circle' ? { width: 145, height: 145 } :
      state.shape === 'oval' ? { width: 230, height: 128 } :
      state.shape === 'hex' ? { width: 220, height: 136 } :
      { width: 235, height: 132 };
    const xOffset = state.placement === 'left' ? -75 : state.placement === 'right' ? 75 : 0;
    const width = base.width * state.patchScale;
    const height = base.height * state.patchScale;
    return {
      width,
      height,
      x: 458 - width / 2 + xOffset + state.dragX,
      y: (state.model === 'Richardson PTS30' ? 253 : 262) + state.dragY
    };
  }

  function drawHat() {
    settingsInput.value = JSON.stringify({
      model: state.model,
      material: state.material,
      previewTone: state.toneName,
      shape: state.shape,
      placement: state.placement,
      patchScale: Math.round(state.patchScale * 100),
      patchRotation: state.patchRotation,
      logoScale: Math.round(state.logoScale * 100),
      offsetX: Math.round(state.dragX),
      offsetY: Math.round(state.dragY),
      background: state.darkRoom ? 'dark' : 'light'
    });
    context.clearRect(0, 0, canvas.width, canvas.height);

    const background = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    background.addColorStop(0, state.darkRoom ? '#24313a' : '#f3ede3');
    background.addColorStop(1, state.darkRoom ? '#091119' : '#d7cbbb');
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.fillStyle = 'rgba(20,22,24,.11)';
    context.beginPath();
    context.ellipse(470, 565, 332, 62, 0, 0, Math.PI * 2);
    context.fill();

    const crownTop = state.model === 'Richardson PTS30' ? 180 : 154;
    const crownBottom = state.model === 'Richardson PTS30' ? 475 : 486;
    const hatGradient = context.createLinearGradient(190, crownTop, 680, crownBottom);
    hatGradient.addColorStop(0, lighten(state.tone, 34));
    hatGradient.addColorStop(.48, state.tone);
    hatGradient.addColorStop(1, '#101214');

    context.save();
    context.beginPath();
    context.moveTo(203, crownBottom);
    context.bezierCurveTo(208, 270, 286, crownTop, 454, crownTop);
    context.bezierCurveTo(631, crownTop, 704, 285, 708, crownBottom);
    context.bezierCurveTo(583, 518, 327, 518, 203, crownBottom);
    context.closePath();
    context.fillStyle = hatGradient;
    context.fill();

    context.strokeStyle = 'rgba(255,255,255,.18)';
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(454, crownTop + 5);
    context.quadraticCurveTo(437, 330, 455, 498);
    context.stroke();

    if (state.model === 'Richardson 112') {
      context.save();
      context.beginPath();
      context.moveTo(548, 187);
      context.bezierCurveTo(659, 230, 705, 334, 708, 474);
      context.bezierCurveTo(650, 494, 596, 503, 545, 505);
      context.quadraticCurveTo(585, 334, 548, 187);
      context.closePath();
      context.clip();
      context.strokeStyle = 'rgba(235,235,225,.27)';
      context.lineWidth = 1;
      for (let x = 500; x < 760; x += 13) {
        context.beginPath();
        context.moveTo(x, 170);
        context.lineTo(x - 90, 540);
        context.stroke();
        context.beginPath();
        context.moveTo(x - 130, 170);
        context.lineTo(x + 50, 540);
        context.stroke();
      }
      context.restore();
    }

    context.fillStyle = state.tone;
    context.beginPath();
    context.moveTo(246, 475);
    context.bezierCurveTo(210, 488, 142, 516, 112, 557);
    context.bezierCurveTo(177, 594, 340, 607, 501, 573);
    context.bezierCurveTo(586, 555, 598, 519, 554, 496);
    context.bezierCurveTo(449, 510, 331, 504, 246, 475);
    context.closePath();
    context.fill();
    context.strokeStyle = 'rgba(255,255,255,.12)';
    context.stroke();
    context.restore();

    drawPatch();

    context.fillStyle = state.darkRoom ? '#f5efe5' : '#13212b';
    context.font = '700 21px "DM Sans", Arial';
    context.fillText(state.model, 52, 72);
    context.fillStyle = state.darkRoom ? 'rgba(255,255,255,.62)' : '#777168';
    context.font = '500 14px "DM Sans", Arial';
    context.fillText(`${state.material} · ${state.toneName} placement preview`, 52, 99);
    context.textAlign = 'right';
    context.fillStyle = state.darkRoom ? 'rgba(255,255,255,.48)' : '#8b8378';
    context.fillText(reference, 868, 653);
    context.textAlign = 'left';
  }

  function drawPatch() {
    const position = patchDimensions();
    context.save();
    context.translate(position.x + position.width / 2, position.y + position.height / 2);
    context.rotate(state.patchRotation * Math.PI / 180);
    const patch = {
      x: -position.width / 2,
      y: -position.height / 2,
      width: position.width,
      height: position.height
    };

    if (state.shape === 'circle') {
      context.beginPath();
      context.arc(patch.x + patch.width / 2, patch.y + patch.height / 2, patch.width / 2, 0, Math.PI * 2);
    } else if (state.shape === 'oval') {
      context.beginPath();
      context.ellipse(patch.x + patch.width / 2, patch.y + patch.height / 2, patch.width / 2, patch.height / 2, 0, 0, Math.PI * 2);
    } else if (state.shape === 'hex') {
      hexPath(context, patch.x, patch.y, patch.width, patch.height);
    } else {
      roundedRect(context, patch.x, patch.y, patch.width, patch.height, 16);
    }

    const patchColors = {
      'Genuine Leather': ['#9a6338', '#56341f'],
      'Leatherette': ['#b68954', '#6b4529'],
      'UV Full Color': ['#f2eee6', '#c6c0b6'],
      'Acrylic': ['#1c1f22', '#050607']
    };
    const colors = patchColors[state.material];
    const patchGradient = context.createLinearGradient(patch.x, patch.y, patch.x, patch.y + patch.height);
    patchGradient.addColorStop(0, colors[0]);
    patchGradient.addColorStop(1, colors[1]);
    context.fillStyle = patchGradient;
    context.shadowColor = 'rgba(0,0,0,.28)';
    context.shadowBlur = 10;
    context.shadowOffsetY = 5;
    context.fill();
    context.shadowColor = 'transparent';
    context.clip();

    if (state.material === 'Genuine Leather' || state.material === 'Leatherette') {
      context.globalAlpha = .12;
      context.strokeStyle = '#fff';
      context.lineWidth = 1;
      for (let y = patch.y; y < patch.y + patch.height; y += 8) {
        context.beginPath();
        context.moveTo(patch.x, y);
        context.quadraticCurveTo(patch.x + patch.width / 2, y + 5, patch.x + patch.width, y);
        context.stroke();
      }
      context.globalAlpha = 1;
    }

    if (state.logo) {
      const scale = Math.min((patch.width * .72) / state.logo.width, (patch.height * .64) / state.logo.height) * state.logoScale;
      const width = state.logo.width * scale;
      const height = state.logo.height * scale;
      context.drawImage(state.logo, patch.x + (patch.width - width) / 2, patch.y + (patch.height - height) / 2, width, height);
    } else {
      context.fillStyle = state.material === 'UV Full Color' ? '#17242d' : '#f7efe3';
      context.font = `700 ${Math.min(28, patch.width / Math.max(6, state.text.length) * 1.2)}px "DM Sans", Arial`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(state.text || 'YOUR LOGO', patch.x + patch.width / 2, patch.y + patch.height / 2, patch.width * .78);
      context.textAlign = 'left';
      context.textBaseline = 'alphabetic';
    }

    context.restore();

    context.save();
    context.translate(position.x + position.width / 2, position.y + position.height / 2);
    context.rotate(state.patchRotation * Math.PI / 180);
    context.strokeStyle = 'rgba(255,255,255,.38)';
    context.lineWidth = 2;
    if (state.shape === 'circle') {
      context.beginPath();
      context.arc(patch.x + patch.width / 2, patch.y + patch.height / 2, patch.width / 2 - 6, 0, Math.PI * 2);
    } else if (state.shape === 'oval') {
      context.beginPath();
      context.ellipse(patch.x + patch.width / 2, patch.y + patch.height / 2, patch.width / 2 - 6, patch.height / 2 - 6, 0, 0, Math.PI * 2);
    } else if (state.shape === 'hex') {
      hexPath(context, patch.x + 6, patch.y + 6, patch.width - 12, patch.height - 12);
    } else {
      roundedRect(context, patch.x + 6, patch.y + 6, patch.width - 12, patch.height - 12, 11);
    }
    context.stroke();
    context.restore();
  }

  form.addEventListener('change', (event) => {
    const target = event.target;
    if (target.name === 'hat_model') {
      state.model = target.value;
      summaryModel.textContent = target.value;
    }
    if (target.name === 'preview_tone') {
      state.tone = target.dataset.color;
      state.toneName = target.value;
    }
    if (target.name === 'patch_material') {
      state.material = target.value;
      summaryMaterial.textContent = target.value;
    }
    if (target === shapeSelect) state.shape = target.value;
    if (target === placementSelect) {
      state.placement = target.value;
      state.dragX = 0;
      state.dragY = 0;
    }
    drawHat();
  });

  sizeControl.addEventListener('input', () => {
    state.patchScale = Number(sizeControl.value) / 100;
    sizeOutput.textContent = `${sizeControl.value}%`;
    drawHat();
  });

  rotationControl.addEventListener('input', () => {
    state.patchRotation = Number(rotationControl.value);
    rotationOutput.textContent = `${rotationControl.value}°`;
    drawHat();
  });

  logoSizeControl.addEventListener('input', () => {
    state.logoScale = Number(logoSizeControl.value) / 100;
    logoSizeOutput.textContent = `${logoSizeControl.value}%`;
    drawHat();
  });

  backgroundButton.addEventListener('click', () => {
    state.darkRoom = !state.darkRoom;
    backgroundButton.textContent = state.darkRoom ? 'Light room' : 'Dark room';
    drawHat();
  });

  resetButton.addEventListener('click', () => {
    state.patchScale = 1;
    state.patchRotation = 0;
    state.logoScale = 1;
    state.dragX = 0;
    state.dragY = 0;
    state.darkRoom = false;
    sizeControl.value = '100';
    rotationControl.value = '0';
    logoSizeControl.value = '100';
    sizeOutput.textContent = '100%';
    rotationOutput.textContent = '0°';
    logoSizeOutput.textContent = '100%';
    backgroundButton.textContent = 'Dark room';
    drawHat();
  });

  let draggingPatch = false;
  let lastPointer = null;

  function canvasPoint(event) {
    const bounds = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * (canvas.width / bounds.width),
      y: (event.clientY - bounds.top) * (canvas.height / bounds.height)
    };
  }

  canvas.addEventListener('pointerdown', (event) => {
    const point = canvasPoint(event);
    const patch = patchDimensions();
    const padding = 24;
    const inside = point.x >= patch.x - padding &&
      point.x <= patch.x + patch.width + padding &&
      point.y >= patch.y - padding &&
      point.y <= patch.y + patch.height + padding;
    if (!inside) return;
    draggingPatch = true;
    lastPointer = point;
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!draggingPatch || !lastPointer) return;
    const point = canvasPoint(event);
    state.dragX = Math.max(-190, Math.min(190, state.dragX + point.x - lastPointer.x));
    state.dragY = Math.max(-90, Math.min(105, state.dragY + point.y - lastPointer.y));
    lastPointer = point;
    drawHat();
  });

  function stopDragging(event) {
    draggingPatch = false;
    lastPointer = null;
    if (event.pointerId !== undefined && canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  }

  canvas.addEventListener('pointerup', stopDragging);
  canvas.addEventListener('pointercancel', stopDragging);

  previewText.addEventListener('input', () => {
    state.text = previewText.value.toUpperCase();
    drawHat();
  });

  logoInput.addEventListener('change', () => {
    const file = logoInput.files[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      logoInput.value = '';
      window.alert('Please choose artwork smaller than 8 MB.');
      return;
    }
    if (file.type === 'application/pdf') {
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

  removeLogo.addEventListener('click', () => {
    logoInput.value = '';
    state.logo = null;
    uploadStatus.hidden = true;
    drawHat();
  });

  downloadButton.addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = `${reference}-${state.model.replaceAll(' ', '-')}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  });

  form.addEventListener('submit', (event) => {
    if (form.dataset.mockupReady === 'true') return;
    event.preventDefault();
    submitButton.disabled = true;
    submitButton.querySelector('span').textContent = 'Preparing mock-up…';
    canvas.toBlob((blob) => {
      if (!blob) {
        submitButton.disabled = false;
        submitButton.querySelector('span').textContent = 'Send my mock-up';
        return;
      }
      const file = new File([blob], `${reference}-mockup.png`, { type: 'image/png' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      generatedFile.files = transfer.files;
      form.dataset.mockupReady = 'true';
      submitButton.querySelector('span').textContent = 'Sending…';
      form.requestSubmit();
    }, 'image/png');
  });

  drawHat();
}
