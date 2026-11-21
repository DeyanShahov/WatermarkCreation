/**
 * UI module - all DOM manipulation and rendering logic.
 * Keeps the main.js clean and focused on orchestration.
 */

/** @type {Map<string, HTMLElement>} */
const refs = new Map();

/** Register a reference by ID. */
export function ref(id) {
  if (!refs.has(id)) {
    const el = document.getElementById(id);
    if (el) refs.set(id, el);
  }
  return refs.get(id);
}

/** Clear a cached reference (useful after DOM element replacement). */
export function clearRef(id) {
  refs.delete(id);
}

/** Initialize all references at once. */
export function createRefs() {
  const ids = [
    // Main sections
    'app-root', 'main-view', 'gallery-view', 'category-view', 'step-view', 'settings-view',
    // Navigation
    'nav-main', 'nav-gallery', 'nav-categories', 'nav-settings', 'nav-help',
    // Main page quick actions
    'nav-gallery-quick', 'nav-categories-quick',
    // Gallery
    'gallery-grid', 'gallery-empty', 'gallery-count', 'btn-load-photos', 'btn-load-photos-gallery', 'btn-select-all', 'btn-deselect-all', 'btn-delete-all-photos', 'btn-process-selected',
    // Category management
    'category-list', 'btn-add-category', 'btn-export-categories', 'btn-import-categories',
    'category-modal', 'category-form',
    'category-name', 'category-description', 'category-order',
    'btn-save-category', 'btn-cancel-category', 'btn-delete-category',
    // Step management
    'step-list', 'btn-add-step', 'btn-back-category', 'btn-process-category-step', 'step-modal', 'step-form',
    'step-name', 'step-description', 'step-message', 'step-photos-required', 'step-order',
    'btn-save-step', 'btn-cancel-step', 'btn-delete-step',
    // Enrichment Modal
    'enrichment-modal', 'enrichment-tabs',
    'tab-full-watermark', 'tab-only-digit',
    'panel-full-watermark', 'panel-only-digit',
    'enrichment-address', 'enrichment-address-validated', 'btn-validate-address', 'btn-geocode-preview',
    'enrichment-geocode-preview', 'preview-latlon-decimal', 'preview-latlon-dms', 'preview-address', 'preview-displayname', 'preview-confidence',
    'enrichment-date', 'enrichment-time',
    'preview-temperature', 'preview-humidity', 'btn-refresh-weather', 'weather-status',
    'enrichment-watermark-mode', 'enrichment-number-position',
    'enrichment-step-message', 'enrichment-category-name', 'enrichment-step-name',
    'btn-cancel-enrichment', 'btn-save-enrichment', 'btn-process-enrichment',
    // Only Digit Tab
    'only-digit-position', 'only-digit-numbering', 'only-digit-step-symbols',
    'only-digit-step-symbols-grid', 'only-digit-sequential-info',
    'only-digit-include-message',
    // AI Settings
    'ai-endpoint', 'ai-api-key', 'ai-model', 'ai-prompt',
    'btn-test-ai', 'btn-save-ai', 'ai-test-result', 'ai-test-output',
    // Photo assignment
    'photo-selection-modal', 'photo-selection-grid', 'photo-selection-count',
    'btn-confirm-selection', 'btn-cancel-selection',
    // Watermark settings
    'watermark-settings-form', 'wm-show-coordinates', 'wm-show-altitude', 'wm-show-datetime',
    'wm-show-address', 'wm-show-weather', 'wm-show-qr', 'wm-show-photo-number',
    'wm-show-category-step', 'wm-show-description', 'wm-max-edge', 'wm-quality',
    'btn-save-watermark-settings',
    // Processing
    'process-modal', 'process-progress', 'process-status', 'process-current',
    'process-results', 'btn-download-all', 'btn-close-process',
    // Quick Watermark
    'quick-watermark-modal',
    // Toasts
    'toast-container',
    // Image Preview Modal
    'image-preview-modal', 'image-preview-modal-image', 'image-preview-modal-close',
    // Dashboard stats
    'stat-photos', 'stat-categories', 'stat-steps', 'stat-assigned',
  ];

  for (const id of ids) {
    ref(id); // Pre-populate the map
  }

  return new Proxy({}, {
    get(_, prop) {
      return ref(prop);
    },
  });
}

/** Show/hide element. */
export function show(el, visible = true) {
  if (!el) return;
  el.hidden = !visible;
}

/** Set element text content safely. */
export function setText(el, text) {
  if (!el) return;
  el.textContent = text ?? '';
}

/** Set element HTML safely. */
export function setHTML(el, html) {
  if (!el) return;
  el.innerHTML = html ?? '';
}

/** Add/remove class. */
export function toggleClass(el, className, force) {
  if (!el) return;
  el.classList.toggle(className, force);
}

/** Create element with attributes and children. */
export function createElement(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  // Boolean attributes that should be set as properties, not attributes
  const booleanAttrs = new Set([
    'checked', 'disabled', 'selected', 'readonly', 'required',
    'multiple', 'hidden', 'autofocus', 'autoplay', 'controls',
    'loop', 'muted', 'open', 'reversed', 'async', 'defer',
    'ismap', 'novalidate', 'formnovalidate', 'itemscope'
  ]);

  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') el.className = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (booleanAttrs.has(key) && typeof value === 'boolean') {
      // Set boolean properties directly (not as attributes)
      el[key] = value;
    }
    else {
      el.setAttribute(key, value);
    }
  }
  for (const child of children) {
    if (child == null) continue;
    if (typeof child === 'string') el.appendChild(document.createTextNode(child));
    else el.appendChild(child);
  }
  return el;
}

/** Format bytes for display. */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

/** Show a toast notification. */
export function showToast(message, { timeout = 4000, type = 'info' } = {}) {
  const container = ref('toast-container');
  if (!container) return;

  const toast = createElement('div', { class: `toast toast--${type}` }, message);
  container.appendChild(toast);

  // Force reflow for animation
  toast.offsetHeight;
  toast.classList.add('toast--show');

  setTimeout(() => {
    toast.classList.remove('toast--show');
    setTimeout(() => toast.remove(), 300);
  }, timeout);
}

/** Set button busy state. */
export function setBusy(button, busy, busyText = 'Зареждане…') {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText ?? button.textContent;
    button.disabled = false;
  }
}

/** Get input element value. */
export function getValue(id) {
  const el = ref(id);
  if (!el) return '';
  return el.type === 'checkbox' ? el.checked : (el.value ?? '');
}

/** Set input element value. */
export function setValue(id, value) {
  const el = ref(id);
  if (!el) return;
  if (el.type === 'checkbox') {
    el.checked = Boolean(value);
  } else if (el.type === 'radio') {
    // For radio groups, use querySelector
    const radio = document.querySelector(`input[name="${el.name}"][value="${value}"]`);
    if (radio) radio.checked = true;
  } else {
    el.value = value ?? '';
  }
}

/** Focus an element. */
export function focus(id) {
  const el = ref(id);
  if (el && typeof el.focus === 'function') {
    el.focus();
  }
}

/* ------------------------------ Gallery View ------------------------------ */

/** Render the gallery grid. */
export function renderGallery(photos, { selectedPhotoIds = [], onSelect, onClick, onAssign, onDelete, onPreview, categories = [] } = {}) {
  console.log('🟣 [ui.renderGallery] Called with', photos?.length || 0, 'photos, selected:', selectedPhotoIds.length);
  const grid = ref('gallery-grid');
  const empty = ref('gallery-empty');
  const count = ref('gallery-count');

  if (!grid) {
    console.log('🔴 [ui.renderGallery] grid element not found!');
    return;
  }

  if (!photos || photos.length === 0) {
    console.log('🟣 [ui.renderGallery] No photos - showing empty state');
    show(grid, false);
    show(empty, true);
    setText(count, '0');
    return;
  }

  console.log('🟣 [ui.renderGallery] Rendering', photos.length, 'photos');
  show(grid, true);
  show(empty, false);
  setText(count, String(photos.length));

  grid.innerHTML = '';

  // Build step info map for name lookup (categoryName, stepName)
  const stepInfoMap = new Map();
  for (const cat of categories) {
    for (const step of cat.steps || []) {
      stepInfoMap.set(step.id, { categoryName: cat.name, stepName: step.name });
    }
  }

  // Calculate global positions per category - MATCH renderSteps logic exactly
  // Iterate categories in array order, then steps in array order, then photos by position
  const globalPositionMap = new Map(); // photoId -> { globalPosition, categoryName, stepName }
  
  for (const cat of categories) {
    let counter = 1;
    for (const step of cat.steps || []) {
      // Find photos for this category + step
      const stepPhotos = photos.filter(p => p.categoryId === cat.id && p.stepId === step.id);
      // Sort by local position (same as renderSteps)
      stepPhotos.sort((a, b) => (a.position || 0) - (b.position || 0));
      
      for (const photo of stepPhotos) {
        globalPositionMap.set(photo.id, {
          globalPosition: counter++,
          categoryName: cat.name,
          stepName: step.name
        });
      }
    }
  }

  for (const photo of photos) {
    const isSelected = selectedPhotoIds.includes(photo.id);
    const globalInfo = globalPositionMap.get(photo.id) || { 
      globalPosition: null, 
      categoryName: photo.categoryId ? (photo.categoryName || '—') : '—', 
      stepName: photo.stepId ? (photo.stepName || '—') : '—' 
    };
    const card = createPhotoCard(photo, { 
      isSelected, 
      onSelect, 
      onClick, 
      onDelete,
      onPreview,        // Pass preview handler
      globalPosition: globalInfo.globalPosition,
      categoryName: globalInfo.categoryName,
      stepName: globalInfo.stepName
    });
    grid.appendChild(card);
  }
  console.log('🟣 [ui.renderGallery] Done rendering');
}

/** Create a photo card element. */
function createPhotoCard(photo, { 
  isSelected = false, 
  onSelect, 
  onClick, 
  onDelete,
  onPreview,        // NEW: double-click handler for image preview
  globalPosition = null,
  categoryName = '—',
  stepName = '—'
} = {}) {
  console.log('🟣 [ui.createPhotoCard] Creating card for:', photo.filename, photo.id, 'selected:', isSelected);
  const isAssigned = photo.categoryId && photo.stepId;

  const card = createElement('div', {
    class: `photo-card${isSelected ? ' photo-card--selected' : ''}${isAssigned ? ' photo-card--assigned' : ''}`,
    dataset: { id: photo.id },
  });

  // Thumbnail
  const img = createElement('img', {
    class: 'photo-card__img',
    src: photo.thumbnailUrl || URL.createObjectURL(photo.thumbnail || photo.file),
    alt: photo.filename,
    loading: 'lazy',
  });

  // Double-click on image to open full-size preview
  if (onPreview) {
    img.addEventListener('dblclick', (e) => {
      e.stopPropagation(); // Prevent card click
      onPreview(photo);
    });
    // Add cursor style to indicate it's clickable
    img.style.cursor = 'zoom-in';
  }

  // Selection checkbox
  const checkbox = createElement('input', {
    type: 'checkbox',
    class: 'photo-card__checkbox',
    checked: isSelected,
    'aria-label': 'Избери снимка',
  });
  checkbox.addEventListener('change', (e) => {
    console.log('🟣 [ui.checkbox] Changed for:', photo.id, e.target.checked);
    e.stopPropagation();
    onSelect?.(photo.id, e.target.checked);
  });

  // Info overlay - each piece on its own line
  // For unassigned photos, show only filename (no category/step/position)
  const info = createElement('div', { class: 'photo-card__info' },
    createElement('div', { class: 'photo-card__name' }, photo.filename),
    isAssigned ? createElement('div', { class: 'photo-card__meta' },
      createElement('div', { class: 'photo-card__meta-line' }, `Категория: ${categoryName}`),
      createElement('div', { class: 'photo-card__meta-line' }, `Стъпка: ${stepName}`),
      globalPosition !== null ? createElement('div', { class: 'photo-card__meta-line' }, `Позиция: #${globalPosition}`) : null
    ) : null
  );

  // Actions container (bottom buttons)
  const actions = createElement('div', { class: 'photo-card__actions' });

  // Delete button (positioned absolutely at top-left of card via CSS)
  if (onDelete) {
    const deleteBtn = createElement('button', {
      class: 'photo-card__delete',
      'aria-label': 'Изтрий снимка',
      title: 'Изтрий снимка',
    }, '🗑');
    deleteBtn.addEventListener('click', (e) => {
      console.log('🟣 [ui.deleteBtn] Clicked for:', photo.id);
      e.stopPropagation();
      onDelete(photo.id);
    });
    // Append directly to card for absolute positioning at top-left
    card.appendChild(deleteBtn);
  }

  // Click on card (not on image/buttons/checkbox) - for selection/assignment
  card.addEventListener('click', () => {
    console.log('🟣 [ui.card] Clicked:', photo.id);
    onClick?.(photo);
  });

  card.append(img, checkbox, info, actions);

  return card;
}

/** Update a single photo card's selection state. */
export function updatePhotoCardSelection(photoId, selected) {
  const grid = ref('gallery-grid');
  if (!grid) return;
  const card = grid.querySelector(`.photo-card[data-id="${photoId}"]`);
  if (!card) return;
  toggleClass(card, 'photo-card--selected', selected);
  const checkbox = card.querySelector('.photo-card__checkbox');
  if (checkbox) checkbox.checked = selected;
}

/** Update selected count and related button states. */
export function updateSelectedCount(count) {
  // Enable/disable Process Selected button based on selection
  const processBtn = ref('btn-process-selected');
  if (processBtn) {
    processBtn.disabled = count === 0;
  }
}

/** Update dashboard stats with current counts. */
export function updateDashboardStats({ photos = [], categories = [] } = {}) {
  const statPhotos = ref('stat-photos');
  const statCategories = ref('stat-categories');
  const statSteps = ref('stat-steps');
  const statAssigned = ref('stat-assigned');

  if (statPhotos) setText(statPhotos, String(photos.length));
  
  if (statCategories) setText(statCategories, String(categories.length));
  
  const totalSteps = categories.reduce((sum, cat) => sum + (cat.steps?.length || 0), 0);
  if (statSteps) setText(statSteps, String(totalSteps));
  
  const assignedCount = photos.filter(p => p.categoryId && p.stepId).length;
  if (statAssigned) setText(statAssigned, String(assignedCount));
}

/* ------------------------------ Category View ------------------------------ */

/** Render category list. */
export function renderCategories(categories, { onSelect, onEdit, onDelete, onReorder } = {}) {
  const list = ref('category-list');
  if (!list) return;

  list.innerHTML = '';

  if (!categories || categories.length === 0) {
    list.appendChild(createElement('div', { class: 'empty-state' },
      'Няма категории. Натиснете „Добави категория“ за да започнете.'
    ));
    return;
  }

  for (const category of categories) {
    const item = createElement('div', { class: 'category-item', dataset: { id: category.id } },
      createElement('div', { class: 'category-item__drag', 'aria-label': 'Премести' }, '⋮⋮'),
      createElement('div', { class: 'category-item__info' },
        createElement('h3', { class: 'category-item__name' }, category.name),
        category.description && createElement('p', { class: 'category-item__desc' }, category.description)
      ),
      createElement('div', { class: 'category-item__stats' },
        createElement('span', { class: 'badge' }, `${category.steps?.length || 0} стъпки`)
      ),
      createElement('div', { class: 'category-item__actions' },
        createElement('button', {
          class: 'icon-btn',
          'aria-label': 'Редактирай',
          onclick: () => onEdit?.(category),
        }, '✎'),
        createElement('button', {
          class: 'icon-btn icon-btn--danger',
          'aria-label': 'Изтрий',
          onclick: () => onDelete?.(category.id),
        }, '🗑')
      )
    );

    item.addEventListener('click', (e) => {
      if (!e.target.closest('button') && !e.target.closest('.category-item__drag')) {
        onSelect?.(category);
      }
    });

    list.appendChild(item);
  }

  // Enable drag-and-drop reordering
  enableDragReorder(list, onReorder);
}

/** Enable drag-and-drop reordering for a list. */
function enableDragReorder(list, onReorder) {
  let draggedItem = null;

  list.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.category-item, .step-item');
    if (!item) return;
    draggedItem = item;
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  list.addEventListener('dragend', (e) => {
    const item = e.target.closest('.category-item, .step-item');
    if (item) item.classList.remove('dragging');
    draggedItem = null;
  });

  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const afterElement = getDragAfterElement(list, e.clientY);
    const draggable = document.querySelector('.dragging');
    if (!draggable) return;
    if (afterElement == null) {
      list.appendChild(draggable);
    } else {
      list.insertBefore(draggable, afterElement);
    }
  });

  list.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!draggedItem || !onReorder) return;
    const items = [...list.querySelectorAll('.category-item, .step-item:not(.dragging)')];
    const newOrder = items.map((item) => item.dataset.id);
    onReorder(newOrder);
  });
}

/** Get element after cursor for drag reorder. */
function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.category-item:not(.dragging), .step-item:not(.dragging)')];
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset, element: child };
    }
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
}

/** Enable drag-and-drop reordering for photos within a step. */
function enablePhotoDragReorder(list, onReorder) {
  let draggedItem = null;
  let draggedStepId = null;

  list.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.step-photo-card');
    if (!item) return;
    draggedItem = item;
    draggedStepId = item.dataset.stepId;
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  list.addEventListener('dragend', (e) => {
    const item = e.target.closest('.step-photo-card');
    if (item) item.classList.remove('dragging');
    draggedItem = null;
    draggedStepId = null;
  });

  list.addEventListener('dragover', (e) => {
    const item = e.target.closest('.step-photo-card');
    if (!item || item.dataset.stepId !== draggedStepId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const afterElement = getDragAfterPhotoElement(item.parentElement, e.clientY);
    const draggable = document.querySelector('.step-photo-card.dragging');
    if (!draggable) return;
    if (afterElement == null) {
      item.parentElement.appendChild(draggable);
    } else {
      item.parentElement.insertBefore(draggable, afterElement);
    }
  });

  list.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!draggedItem || !onReorder) return;
    const stepId = draggedStepId;
    const photoList = draggedItem.parentElement;
    const items = [...photoList.querySelectorAll('.step-photo-card:not(.dragging)')];
    const newOrder = items.map((item) => item.dataset.id);
    onReorder({ stepId, photoIds: newOrder });
  });
}

/** Get element after cursor for photo drag reorder. */
function getDragAfterPhotoElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.step-photo-card:not(.dragging)')];
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset, element: child };
    }
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
}

/** Show category modal for create/edit. */
export function showCategoryModal({ category = null, onSave, onCancel } = {}) {
  const modal = ref('category-modal');
  const form = ref('category-form');
  const nameInput = ref('category-name');
  const descInput = ref('category-description');
  const orderInput = ref('category-order');
  const saveBtn = ref('btn-save-category');
  const cancelBtn = ref('btn-cancel-category');
  const deleteBtn = ref('btn-delete-category');

  if (!modal || !form) return;

  // Reset form
  form.reset();
  nameInput.value = category?.name || '';
  descInput.value = category?.description || '';
  orderInput.value = category?.order ?? '';

  // Show/hide delete button
  show(deleteBtn, Boolean(category));
  deleteBtn.onclick = () => {
    if (confirm('Сигурни ли сте, че искате да изтриете тази категория? Всяка стъпка и снимка в нея ще бъде изтрита.')) {
      modal.hidden = true;
      // Trigger delete through the category's own handler
      category?.onDelete?.();
    }
  };

  saveBtn.onclick = () => {
    const name = nameInput.value.trim();
    if (!name) {
      showToast('Моля, въведете име на категорията.', { type: 'error' });
      return;
    }
    modal.hidden = true;
    onSave?.({
      id: category?.id || generateId(),
      name,
      description: descInput.value.trim(),
      order: Number(orderInput.value) || 0,
      steps: category?.steps || [],
    });
  };

  cancelBtn.onclick = () => {
    modal.hidden = true;
    onCancel?.();
  };

  modal.hidden = false;
  nameInput.focus();
}

/* ------------------------------ Step View ------------------------------ */

/** Render step list for a category. */
export function renderSteps(category, {
  onSelect,
  onEdit,
  onDelete,
  onReorder,
  onAssignPhotos,
  photos = [],
  onReorderPhotos,
  onPreview,        // NEW: double-click handler for image preview
} = {}) {
  const list = ref('step-list');
  const categoryName = ref('step-category-name');
  if (!list) return;

  if (categoryName) setText(categoryName, category?.name || 'Стъпки');

  list.innerHTML = '';

  const steps = category?.steps || [];

  if (steps.length === 0) {
    list.appendChild(createElement('div', { class: 'empty-state' },
      'Няма стъпки в тази категория. Натиснете „Добави стъпка“ за да започнете.'
    ));
    return;
  }

  // Group photos by stepId for easy access
  const photosByStep = new Map();
  for (const photo of photos) {
    if (photo.stepId) {
      if (!photosByStep.has(photo.stepId)) photosByStep.set(photo.stepId, []);
      photosByStep.get(photo.stepId).push(photo);
    }
  }

  // Calculate global positions for the entire category (for visual badges)
  // This matches the numbering used during watermark processing
  const globalPositionMap = new Map();
  let globalCounter = 1;
  for (const step of steps) {
    const stepPhotos = photosByStep.get(step.id) || [];
    stepPhotos.sort((a, b) => (a.position || 0) - (b.position || 0));
    for (const photo of stepPhotos) {
      globalPositionMap.set(photo.id, globalCounter++);
    }
  }

  for (const step of steps) {
    const stepPhotos = photosByStep.get(step.id) || [];
    // Sort by local position for drag-and-drop ordering
    stepPhotos.sort((a, b) => (a.position || 0) - (b.position || 0));

    const photoCount = stepPhotos.length;
    const required = step.photosRequired || 0;
    const isComplete = photoCount >= required && required > 0;

    // Create photo thumbnails for this step
    const photosList = createElement('div', { class: 'step-photos-list' });
    if (stepPhotos.length > 0) {
      for (const photo of stepPhotos) {
        const localPosition = photo.position || 0;
        const globalPosition = globalPositionMap.get(photo.id) ?? 0;
        
        // Create image element separately to attach preview handler
        const img = createElement('img', {
          class: 'step-photo-card__img',
          src: photo.thumbnailUrl || URL.createObjectURL(photo.thumbnail || photo.file),
          alt: photo.filename,
          loading: 'lazy',
        });
        
        // Double-click on image to open full-size preview
        if (onPreview) {
          img.addEventListener('dblclick', (e) => {
            e.stopPropagation(); // Prevent drag/card click
            onPreview(photo);
          });
          img.style.cursor = 'zoom-in';
        }
        
        const photoCard = createElement('div', {
          class: 'step-photo-card',
          draggable: true,
          // Keep local position in dataset for drag-and-drop reordering logic
          dataset: { id: photo.id, stepId: step.id, position: localPosition },
        },
          // Show global position in badge so user sees the actual watermark number
          createElement('span', { class: 'step-photo-card__position' }, `${globalPosition}`),
          img,
          createElement('span', { class: 'step-photo-card__name' }, photo.filename)
        );
        photosList.appendChild(photoCard);
      }
    } else {
      photosList.appendChild(createElement('span', { class: 'step-photos-empty' }, 'Няма присвоени снимки'));
    }

    const item = createElement('div', { class: `step-item${isComplete ? ' step-item--complete' : ''}`, dataset: { id: step.id } },
      createElement('div', { class: 'step-item__drag', 'aria-label': 'Премести стъпка' }, '⋮⋮'),
      createElement('div', { class: 'step-item__info' },
        createElement('h3', { class: 'step-item__name' }, step.name),
        step.description && createElement('p', { class: 'step-item__desc' }, step.description),
        createElement('div', { class: 'step-item__progress' },
          createElement('span', { class: 'step-item__count' }, `${photoCount} / ${required} снимки`),
          createElement('div', { class: 'progress-bar' },
            createElement('div', {
              class: `progress-bar__fill${isComplete ? ' progress-bar__fill--complete' : ''}`,
              style: { width: required > 0 ? `${Math.min(100, (photoCount / required) * 100)}%` : '0%' },
            })
          )
        ),
        // Photos section
        createElement('div', { class: 'step-item__photos' },
          createElement('h4', { class: 'step-item__photos-title' }, `Присвоени снимки (${photoCount})`),
          photosList
        )
      ),
      createElement('div', { class: 'step-item__actions' },
        createElement('button', {
          class: 'btn btn--small btn--primary',
          'aria-label': 'Присвои снимки',
          onclick: () => onAssignPhotos?.(step),
        }, photoCount > 0 ? 'Промени снимки' : 'Присвои снимки'),
        createElement('button', {
          class: 'icon-btn',
          'aria-label': 'Редактирай',
          onclick: () => onEdit?.(step),
        }, '✎'),
        createElement('button', {
          class: 'icon-btn icon-btn--danger',
          'aria-label': 'Изтрий',
          onclick: () => onDelete?.(step.id),
        }, '🗑')
      )
    );

    item.addEventListener('click', (e) => {
      if (!e.target.closest('button') && !e.target.closest('.step-item__drag') && !e.target.closest('.step-photo-card')) {
        onSelect?.(step);
      }
    });

    list.appendChild(item);
  }

  // Enable drag-reorder for steps
  enableDragReorder(list, (newOrder) => {
    const stepsCopy = [...steps];
    stepsCopy.sort((a, b) => newOrder.indexOf(a.id) - newOrder.indexOf(b.id));
    onReorder?.(stepsCopy);
  });

  // Enable drag-reorder for photos within each step
  enablePhotoDragReorder(list, onReorderPhotos);
}

/** Show step modal for create/edit. */
export function showStepModal({ step = null, category = null, onSave, onCancel } = {}) {
  const modal = ref('step-modal');
  const form = ref('step-form');
  const nameInput = ref('step-name');
  const descInput = ref('step-description');
  const messageInput = ref('step-message');
  const requiredInput = ref('step-photos-required');
  const orderInput = ref('step-order');
  const saveBtn = ref('btn-save-step');
  const cancelBtn = ref('btn-cancel-step');
  const deleteBtn = ref('btn-delete-step');

  if (!modal || !form) return;

  form.reset();
  nameInput.value = step?.name || '';
  descInput.value = step?.description || '';
  messageInput.value = step?.message || '';
  requiredInput.value = step?.photosRequired || 1;
  orderInput.value = step?.order ?? '';

  show(deleteBtn, Boolean(step));
  deleteBtn.onclick = () => {
    if (confirm('Сигурни ли сте, че искате да изтриете тази стъпка? Всяка присвоена снимка ще бъде премахната.')) {
      modal.hidden = true;
      step?.onDelete?.();
    }
  };

  saveBtn.onclick = () => {
    const name = nameInput.value.trim();
    if (!name) {
      showToast('Моля, въведете име на стъпката.', { type: 'error' });
      return;
    }
    modal.hidden = true;
    onSave?.({
      id: step?.id || generateId(),
      name,
      description: descInput.value.trim(),
      message: messageInput.value.trim(),
      photosRequired: Number(requiredInput.value) || 1,
      order: Number(orderInput.value) || 0,
      photos: step?.photos || [],
    });
  };

  cancelBtn.onclick = () => {
    modal.hidden = true;
    onCancel?.();
  };

  modal.hidden = false;
  nameInput.focus();
}

/* ------------------------------ Photo Selection Modal ------------------------------ */

/** Show photo selection modal for assigning photos to a step. */
export function showPhotoSelectionModal({
  photos = [],
  selectedIds = [],
  stepName = '',
  stepId = null,
  categoryName = '',
  onConfirm,
  onCancel,
  onPreview,        // NEW: double-click handler for image preview
} = {}) {
  const modal = ref('photo-selection-modal');
  const grid = ref('photo-selection-grid');
  const countEl = ref('photo-selection-count');
  const confirmBtn = ref('btn-confirm-selection');
  const cancelBtn = ref('btn-cancel-selection');
  const titleEl = ref('photo-selection-title');

  if (!modal || !grid) return;

  // Update modal title with step info
  if (titleEl) {
    titleEl.textContent = stepName
      ? `Присвои снимки към: ${stepName} ${categoryName ? `(${categoryName})` : ''}`
      : 'Изберете снимки за стъпка';
  }

  grid.innerHTML = '';
  updateSelectionCount(selectedIds.length);

  for (const photo of photos) {
    const isSelected = selectedIds.includes(photo.id);
    const alreadyAssigned = photo.stepId && photo.stepId !== stepId;
    const assignedToThisStep = photo.stepId === stepId;

    const card = createElement('div', {
      class: `photo-selection-card${isSelected ? ' photo-selection-card--selected' : ''}${alreadyAssigned ? ' photo-selection-card--assigned-elsewhere' : ''}${assignedToThisStep ? ' photo-selection-card--assigned-here' : ''}`,
      dataset: { id: photo.id },
    });

    const img = createElement('img', {
      class: 'photo-selection-card__img',
      src: photo.thumbnailUrl || URL.createObjectURL(photo.thumbnail || photo.file),
      alt: photo.filename,
      loading: 'lazy',
    });

    // Double-click on image to open full-size preview
    if (onPreview) {
      img.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        onPreview(photo);
      });
      img.style.cursor = 'zoom-in';
    }

    const checkbox = createElement('input', {
      type: 'checkbox',
      class: 'photo-selection-card__checkbox',
      checked: isSelected,
      disabled: alreadyAssigned,
      'aria-label': `Избери ${photo.filename}`,
    });

    const name = createElement('div', { class: 'photo-selection-card__name' }, photo.filename);

    // Assigned indicator badge
    let badge = null;
    if (alreadyAssigned) {
      const stepName = photo.stepName || 'неизвестна стъпка';
      badge = createElement('span', {
        class: 'photo-selection-card__badge photo-selection-card__badge--warning',
        title: `Вече присвоена към "${stepName}"`,
      }, `⚠ В ${stepName}`);
    } else if (assignedToThisStep) {
      const position = photo.position ? ` #${photo.position}` : '';
      badge = createElement('span', {
        class: 'photo-selection-card__badge photo-selection-card__badge--success',
        title: `Вече в тази стъпка${position}`,
      }, `✓ Тук${position}`);
    }

    card.append(img, checkbox, name);
    if (badge) card.append(badge);

    card.addEventListener('click', (e) => {
      if (e.target !== checkbox && !alreadyAssigned) {
        checkbox.checked = !checkbox.checked;
        toggleSelection(photo.id, checkbox.checked);
      }
    });
    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      toggleSelection(photo.id, e.target.checked);
    });

    grid.appendChild(card);
  }

  function toggleSelection(id, selected) {
    const card = grid.querySelector(`.photo-selection-card[data-id="${id}"]`);
    if (card) toggleClass(card, 'photo-selection-card--selected', selected);
    const newSelected = selected ? [...selectedIds, id] : selectedIds.filter((s) => s !== id);
    selectedIds.length = 0;
    selectedIds.push(...newSelected);
    updateSelectionCount(selectedIds.length);
  }

  function updateSelectionCount(count) {
    setText(countEl, `${count} избрани`);
    // Allow confirming with 0 selections - user may want to remove all photos from step
    confirmBtn.disabled = false;
  }

  confirmBtn.onclick = () => {
    modal.hidden = true;
    onConfirm?.(selectedIds);
  };

  cancelBtn.onclick = () => {
    modal.hidden = true;
    onCancel?.();
  };

  modal.hidden = false;
}

/* ------------------------------ Quick Watermark Modal ------------------------------ */

/** Show quick watermark modal for applying number-only watermark to selected photos. */
export function showQuickWatermarkModal({ 
  photos = [], 
  selectedIds = [], 
  onApply, 
  onCancel,
  currentPosition = 'bottom-right'
} = {}) {
  const modal = ref('quick-watermark-modal');
  const grid = ref('quick-watermark-grid');
  const countEl = ref('quick-watermark-count');
  const positionEl = ref('quick-watermark-position');
  const numberingEl = ref('quick-watermark-numbering');
  const groupInputEl = ref('quick-watermark-group-input');
  const groupValueEl = ref('quick-watermark-group-value');
  const applyBtn = ref('btn-apply-quick-watermark');
  const cancelBtn = ref('btn-cancel-quick-watermark');

  if (!modal || !grid) return;

  // State for numbering mode
  let numberingMode = 'sequential'; // 'sequential' | 'group'
  let groupValue = '';

  // Populate position radio buttons
  if (positionEl) {
    const positionRadios = positionEl.querySelectorAll('input[name="quick-watermark-position"]');
    positionRadios.forEach(radio => {
      radio.checked = radio.value === currentPosition;
    });
  }

  // Set default numbering mode
  if (numberingEl) {
    const numberingRadios = numberingEl.querySelectorAll('input[name="quick-watermark-numbering"]');
    numberingRadios.forEach(radio => {
      radio.checked = radio.value === numberingMode;
    });
  }

  // Hide group input initially
  if (groupInputEl) groupInputEl.hidden = true;

  // Numbering mode change handler
  function handleNumberingModeChange() {
    if (!numberingEl) return;
    const checked = numberingEl.querySelector('input[name="quick-watermark-numbering"]:checked');
    if (checked) {
      numberingMode = checked.value;
      // Show/hide group input
      if (groupInputEl) {
        groupInputEl.hidden = numberingMode !== 'group';
      }
      // Update badges
      updateAllBadges();
    }
  }

  // Group value change handler
  function handleGroupValueChange() {
    if (groupValueEl) {
      groupValue = groupValueEl.value.trim();
      updateAllBadges();
    }
  }

  // Attach event listeners
  if (numberingEl) {
    numberingEl.addEventListener('change', handleNumberingModeChange);
  }
  if (groupValueEl) {
    groupValueEl.addEventListener('input', handleGroupValueChange);
  }

  grid.innerHTML = '';
  updateQuickWatermarkCount(selectedIds.length);

  // Store card number elements for easy updates
  const cardNumberElements = [];

  // Render selected photos in selection order
  for (let i = 0; i < selectedIds.length; i++) {
    const photoId = selectedIds[i];
    const photo = photos.find(p => p.id === photoId);
    if (!photo) continue;

    const badgeText = computeBadgeText(i, numberingMode, groupValue);

    const card = createElement('div', {
      class: 'quick-watermark-card',
      dataset: { id: photo.id },
    },
      createElement('span', { class: 'quick-watermark-card__number' }, badgeText),
      createElement('img', {
        class: 'quick-watermark-card__img',
        src: photo.thumbnailUrl || URL.createObjectURL(photo.thumbnail || photo.file),
        alt: photo.filename,
        loading: 'lazy',
      }),
      createElement('span', { class: 'quick-watermark-card__name' }, photo.filename)
    );
    grid.appendChild(card);
    
    // Store reference to the number element for updates
    cardNumberElements.push(card.querySelector('.quick-watermark-card__number'));
  }

  function updateQuickWatermarkCount(count) {
    setText(countEl, `Избрани: ${count} снимки`);
    if (applyBtn) applyBtn.disabled = count === 0;
  }

  function getSelectedPosition() {
    if (!positionEl) return currentPosition;
    const checked = positionEl.querySelector('input[name="quick-watermark-position"]:checked');
    return checked ? checked.value : currentPosition;
  }

  function computeBadgeText(index, mode, groupVal) {
    switch (mode) {
      case 'sequential':
        return `#${index + 1}`;
      case 'group':
        return groupVal ? `#${groupVal}` : `#1`;
      default:
        return `#${index + 1}`;
    }
  }

  function updateAllBadges() {
    cardNumberElements.forEach((el, index) => {
      if (el) {
        el.textContent = computeBadgeText(index, numberingMode, groupValue);
      }
    });
  }

  applyBtn.onclick = () => {
    const position = getSelectedPosition();
    modal.hidden = true;
    onApply?.(selectedIds, position, { numberingMode, groupValue });
  };

  cancelBtn.onclick = () => {
    modal.hidden = true;
    onCancel?.();
  };

  modal.hidden = false;
}

/* ------------------------------ Watermark Settings ------------------------------ */

/** Load watermark settings into form. */
export function loadWatermarkSettings(settings) {
  const form = ref('watermark-settings-form');
  if (!form) return;

  for (const [key, value] of Object.entries(settings)) {
    const input = form.querySelector(`[name="${key}"]`);
    if (input) {
      if (input.type === 'checkbox') input.checked = Boolean(value);
      else input.value = value;
    }
  }
}

/** Get watermark settings from form. */
export function getWatermarkSettings() {
  const form = ref('watermark-settings-form');
  if (!form) return {};

  const settings = {};
  for (const input of form.querySelectorAll('input, select')) {
    if (input.type === 'checkbox') settings[input.name] = input.checked;
    else if (input.type === 'number') settings[input.name] = Number(input.value);
    else settings[input.name] = input.value;
  }
  return settings;
}

/* ------------------------------ Processing Modal ------------------------------ */

/** Show processing modal. */
export function showProcessModal() {
  const modal = ref('process-modal');
  if (modal) {
    modal.hidden = false;
    setText(ref('process-status'), 'Подготовка...');
    setText(ref('process-current'), '');
    ref('process-progress').value = 0;
    ref('process-results').innerHTML = '';
    show(ref('btn-download-all'), false);
  }
}

/** Hide processing modal and clear results. */
export function hideProcessModal() {
  const modal = ref('process-modal');
  if (modal) {
    modal.hidden = true;
    // Clear results to avoid showing old data on next open
    ref('process-results').innerHTML = '';
    setText(ref('process-status'), '');
    setText(ref('process-current'), '');
    ref('process-progress').value = 0;
    show(ref('btn-download-all'), false);
  }
}

/** Update processing progress. */
export function updateProcessProgress({ current, total, status, currentFile }) {
  const progress = ref('process-progress');
  const statusEl = ref('process-status');
  const currentEl = ref('process-current');

  if (progress) progress.value = total > 0 ? (current / total) * 100 : 0;
  if (statusEl) setText(statusEl, status);
  if (currentEl && currentFile) setText(currentEl, currentFile);
}

/** Add processing result. */
export function addProcessResult(photo, success, error = null) {
  const results = ref('process-results');
  if (!results) return;

  const item = createElement('div', {
    class: `process-result${success ? ' process-result--success' : ' process-result--error'}`,
  });

  const name = createElement('span', { class: 'process-result__name' }, photo.filename);
  const status = createElement('span', { class: 'process-result__status' },
    success ? '✓ Готово' : `✗ ${error || 'Грешка'}`
  );

  item.append(name, status);
  results.appendChild(item);
  results.scrollTop = results.scrollHeight;
}

/** Show processing complete. */
export function finishProcessing(results) {
  const statusEl = ref('process-status');
  const downloadBtn = ref('btn-download-all');

  if (statusEl) setText(statusEl, `Завършено: ${results.success} успешни, ${results.errors} грешки`);
  show(downloadBtn, results.success > 0);
}

/* ------------------------------ Enrichment Modal ------------------------------ */

/** Show enrichment modal for category watermark configuration. */
export async function showEnrichmentModal({ category = null, step = null, onSave, onProcess, onCancel } = {}) {
  console.log('🔵 [showEnrichmentModal] === START ===');
  console.log('🔵 [showEnrichmentModal] category:', category ? { id: category.id, name: category.name, steps: category.steps?.map(s => ({ id: s.id, name: s.name })) } : null);
  console.log('🔵 [showEnrichmentModal] step:', step ? { id: step.id, name: step.name } : null);
  console.log('🔵 [showEnrichmentModal] category.enrichment:', category?.enrichment);
  
  const modal = ref('enrichment-modal');
  if (!modal) return;

  // Store categoryId on modal for event handlers
  const categoryId = category?.id || null;
  modal.dataset.categoryId = categoryId;
  console.log('🔵 [showEnrichmentModal] Set modal.dataset.categoryId:', categoryId);

  // Reset form
  resetEnrichmentForm();

  // Set category/step info
  if (category) {
    setValue('enrichment-category-name', category.name);
  }
  if (step) {
    setValue('enrichment-step-name', step.name);
    setValue('enrichment-step-message', step.message || '');
  }

  // Load saved enrichment data for this category
  if (category?.enrichment) {
    console.log('🔵 [showEnrichmentModal] Loading saved enrichment data:', category.enrichment);
    loadEnrichmentData(category.enrichment);
  }

  // Initialize Only Digit tab with category steps
  if (category?.steps && category.steps.length > 0) {
    console.log('🔵 [showEnrichmentModal] Initializing Only Digit tab with steps:', category.steps.map(s => ({ id: s.id, name: s.name })));
    initOnlyDigitTab(category.steps, category.enrichment?.onlyDigit);
  }

  // Tab switching
  setupEnrichmentTabs();

  // Load AI settings with categoryId
  await loadAIForm(categoryId);

  // Event listeners
  setupEnrichmentEvents({ onSave, onProcess, onCancel, categoryId });

  // Set default date to today
  const today = new Date().toISOString().split('T')[0];
  setValue('enrichment-date', today);

  modal.hidden = false;
  focus('enrichment-address');
}

/** Hide enrichment modal. */
export function hideEnrichmentModal() {
  const modal = ref('enrichment-modal');
  if (modal) modal.hidden = true;
}

/** Reset enrichment form to defaults. */
function resetEnrichmentForm() {
  const form = ref('enrichment-modal')?.querySelector('form') || ref('enrichment-modal');
  if (form) {
    // Reset all inputs
    form.querySelectorAll('input, textarea, select').forEach(el => {
      if (el.type === 'radio' || el.type === 'checkbox') {
        el.checked = el.defaultChecked;
      } else {
        el.value = el.defaultValue || '';
      }
    });
  }
  // Reset Only Digit tab specifically
  const onlyDigitPositionEl = ref('only-digit-position');
  const onlyDigitNumberingEl = ref('only-digit-numbering');
  const onlyDigitStepSymbolsEl = ref('only-digit-step-symbols');
  const onlyDigitStepSymbolsGridEl = ref('only-digit-step-symbols-grid');
  const onlyDigitSequentialInfoEl = ref('only-digit-sequential-info');

  if (onlyDigitPositionEl) {
    const radios = onlyDigitPositionEl.querySelectorAll('input[name="only-digit-position"]');
    radios.forEach(radio => {
      radio.checked = radio.value === 'bottom-right';
    });
  }
  if (onlyDigitNumberingEl) {
    const radios = onlyDigitNumberingEl.querySelectorAll('input[name="only-digit-numbering"]');
    radios.forEach(radio => {
      radio.checked = radio.value === 'sequential';
    });
  }
  if (onlyDigitStepSymbolsEl) onlyDigitStepSymbolsEl.hidden = true;
  if (onlyDigitStepSymbolsGridEl) onlyDigitStepSymbolsGridEl.innerHTML = '';
  if (onlyDigitSequentialInfoEl) onlyDigitSequentialInfoEl.hidden = false;

  // Reset tabs
  const tabs = ref('enrichment-tabs');
  if (tabs) {
    tabs.querySelectorAll('.enrichment-tab').forEach((tab, i) => {
      tab.classList.toggle('enrichment-tab--active', i === 0);
      tab.setAttribute('aria-selected', i === 0);
    });
  }
  const panels = ['panel-full-watermark', 'panel-only-digit'];
  panels.forEach((panelId, i) => {
    const panel = ref(panelId);
    if (panel) panel.hidden = i !== 0;
  });
  // Hide preview
  show(ref('enrichment-geocode-preview'), false);
  show(ref('btn-refresh-weather'), false);
  show(ref('ai-test-result'), false);
  setText(ref('weather-status'), 'Въведете адрес и дата, след което натиснете „🔍 Преглед на координати“ за да се извлечат метео данните.');
}

/** Load saved enrichment data into form. */
function loadEnrichmentData(enrichment) {
  console.log('🔵 [loadEnrichmentData] === START ===', enrichment);
  if (!enrichment) return;
  console.log('🔵 [loadEnrichmentData] Loading enrichment:', enrichment);
  if (enrichment.address) setValue('enrichment-address', enrichment.address);
  if (enrichment.addressValidated) setValue('enrichment-address-validated', enrichment.addressValidated);
  if (enrichment.date) setValue('enrichment-date', enrichment.date);
  if (enrichment.time) setValue('enrichment-time', enrichment.time);
  if (enrichment.watermarkMode) setValue('enrichment-watermark-mode', enrichment.watermarkMode);
  if (enrichment.numberPosition) {
    const radio = document.querySelector(`input[name="enrichment-number-position"][value="${enrichment.numberPosition}"]`);
    if (radio) radio.checked = true;
  }
  // Load onlyDigit config if present
  if (enrichment.onlyDigit) {
    console.log('🔵 [loadEnrichmentData] Loading onlyDigit config:', enrichment.onlyDigit);
    // The initOnlyDigitTab will handle this
  }
  // Update weather preview if we have data
  if (enrichment.temperature !== undefined) {
    setText(ref('preview-temperature'), `${enrichment.temperature} °C`);
  }
  if (enrichment.humidity !== undefined) {
    setText(ref('preview-humidity'), `${enrichment.humidity} %`);
  }
  show(ref('btn-refresh-weather'), true);
  setText(ref('weather-status'), 'Метео данни са заредени от запазената конфигурация.');
}

/** Initialize Only Digit tab with category steps and saved settings. */
function initOnlyDigitTab(steps, savedOnlyDigit = null) {
  console.log('🔵 [initOnlyDigitTab] === START ===', { steps: steps?.map(s => ({ id: s.id, name: s.name })), savedOnlyDigit });
  const positionEl = ref('only-digit-position');
  const numberingEl = ref('only-digit-numbering');
  const stepSymbolsEl = ref('only-digit-step-symbols');
  const stepSymbolsGridEl = ref('only-digit-step-symbols-grid');
  const sequentialInfoEl = ref('only-digit-sequential-info');
  const includeMessageEl = ref('only-digit-include-message');

  if (!positionEl || !numberingEl || !stepSymbolsEl || !stepSymbolsGridEl) {
    console.log('🔵 [initOnlyDigitTab] Missing elements, returning');
    return;
  }

  // Default values
  let numberingMode = 'sequential';
  let stepSymbols = {}; // stepId -> symbol
  let includeMessage = false;

  // Load saved settings if available
  if (savedOnlyDigit) {
    numberingMode = savedOnlyDigit.numberingMode || 'sequential';
    stepSymbols = savedOnlyDigit.stepSymbols || {};
    includeMessage = savedOnlyDigit.includeMessage || false;
    console.log('🔵 [initOnlyDigitTab] Loaded saved settings:', { numberingMode, stepSymbols, includeMessage });
  }

  // Set position radio (default to bottom-right)
  const savedPosition = savedOnlyDigit?.position || 'bottom-right';
  const positionRadios = positionEl.querySelectorAll('input[name="only-digit-position"]');
  positionRadios.forEach(radio => {
    radio.checked = radio.value === savedPosition;
  });

  // Set numbering mode radio
  const numberingRadios = numberingEl.querySelectorAll('input[name="only-digit-numbering"]');
  console.log(`🔵 [initOnlyDigitTab] Found numbering radios: ${numberingRadios.length}, numberingMode: ${numberingMode}`);
  numberingRadios.forEach(radio => {
    const shouldCheck = radio.value === numberingMode;
    console.log(`🔵 [initOnlyDigitTab] Radio value="${radio.value}", shouldCheck=${shouldCheck}`);
    radio.checked = shouldCheck;
  });

  // Set include message checkbox
  if (includeMessageEl) {
    includeMessageEl.checked = includeMessage;
    console.log(`🔵 [initOnlyDigitTab] Set includeMessage checkbox: ${includeMessage}`);
  }
  
  // Verify the radio buttons were set correctly
  const checkedRadio = numberingEl.querySelector('input[name="only-digit-numbering"]:checked');
  console.log(`🔵 [initOnlyDigitTab] After setting, checked radio:`, checkedRadio?.value || 'none');

  // Generate step symbol inputs
  stepSymbolsGridEl.innerHTML = '';
  steps.forEach(step => {
    const savedSymbol = stepSymbols[step.id] || '';
    console.log(`🔵 [initOnlyDigitTab] Creating input for step: ${step.name} (${step.id}), savedSymbol: "${savedSymbol}"`);
    const item = createElement('div', { class: 'step-symbol-item' },
      createElement('label', {},
        createElement('span', {}, `Стъпка: ${step.name}`),
        createElement('input', {
          type: 'text',
          name: `only-digit-step-symbol-${step.id}`,
          value: savedSymbol,
          placeholder: 'напр. А, 1, ★',
          maxlength: '10',
          dataset: { stepId: step.id }
        })
      )
    );
    stepSymbolsGridEl.appendChild(item);
  });

  // Show/hide step symbols based on numbering mode
  function updateStepSymbolsVisibility() {
    const checked = numberingEl.querySelector('input[name="only-digit-numbering"]:checked');
    if (checked) {
      numberingMode = checked.value;
      stepSymbolsEl.hidden = numberingMode !== 'group';
      sequentialInfoEl.hidden = numberingMode === 'group';
    }
  }

  // Initial visibility
  updateStepSymbolsVisibility();

  // Attach event listeners
  numberingEl.addEventListener('change', updateStepSymbolsVisibility);

  // Store references for later retrieval
  stepSymbolsEl.dataset.numberingMode = numberingMode;
}

/** Get Only Digit configuration from form. */
function getOnlyDigitConfig() {
  console.log('🔵 [getOnlyDigitConfig] === START ===');
  const positionEl = ref('only-digit-position');
  const numberingEl = ref('only-digit-numbering');
  const stepSymbolsGridEl = ref('only-digit-step-symbols-grid');
  const includeMessageEl = ref('only-digit-include-message');

  if (!positionEl || !numberingEl || !stepSymbolsGridEl) {
    console.log('🔵 [getOnlyDigitConfig] Missing elements, returning null');
    return null;
  }

  // Debug: check all radio buttons
  const allNumberingRadios = numberingEl.querySelectorAll('input[name="only-digit-numbering"]');
  console.log(`🔵 [getOnlyDigitConfig] All numbering radios:`, Array.from(allNumberingRadios).map(r => ({ value: r.value, checked: r.checked })));

  const positionChecked = positionEl.querySelector('input[name="only-digit-position"]:checked');
  const numberingChecked = numberingEl.querySelector('input[name="only-digit-numbering"]:checked');

  console.log(`🔵 [getOnlyDigitConfig] positionChecked:`, positionChecked?.value);
  console.log(`🔵 [getOnlyDigitConfig] numberingChecked:`, numberingChecked?.value);

  const config = {
    position: positionChecked?.value || 'bottom-right',
    numberingMode: numberingChecked?.value || 'sequential',
    stepSymbols: {},
    includeMessage: includeMessageEl?.checked || false
  };

  // Collect step symbols if in group mode
  if (config.numberingMode === 'group' && stepSymbolsGridEl) {
    const inputs = stepSymbolsGridEl.querySelectorAll('input[type="text"]');
    console.log('🔵 [getOnlyDigitConfig] Found step symbol inputs:', inputs.length);
    inputs.forEach(input => {
      const stepId = input.dataset.stepId;
      if (stepId && input.value.trim()) {
        config.stepSymbols[stepId] = input.value.trim();
        console.log(`🔵 [getOnlyDigitConfig] Step symbol: ${stepId} = "${input.value.trim()}"`);
      }
    });
  }

  console.log('🔵 [getOnlyDigitConfig] Returning config:', config);
  return config;
}

/** Setup tab switching. */
function setupEnrichmentTabs() {
  const tabsContainer = ref('enrichment-tabs');
  if (!tabsContainer) return;

  const tabs = tabsContainer.querySelectorAll('.enrichment-tab');
  tabs.forEach(tab => {
    // Remove existing listener to avoid duplicates
    tab.replaceWith(tab.cloneNode(true));
  });
  
  // Re-query after clone
  const newTabs = tabsContainer.querySelectorAll('.enrichment-tab');
  newTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.getAttribute('aria-controls');
      // Update tabs
      newTabs.forEach(t => {
        t.classList.remove('enrichment-tab--active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('enrichment-tab--active');
      tab.setAttribute('aria-selected', 'true');
      // Update panels
      ['panel-full-watermark', 'panel-only-digit'].forEach(panelId => {
        const panel = ref(panelId);
        if (panel) panel.hidden = panelId !== targetId;
      });
    });
  });
}

/** Setup event listeners for enrichment modal. */
function setupEnrichmentEvents({ onSave, onProcess, onCancel, categoryId }) {
  // Close buttons - clone to remove old listeners
  const closeBtn = ref('enrichment-modal')?.querySelector('.modal__close');
  const cancelBtn = ref('btn-cancel-enrichment');
  const saveBtn = ref('btn-save-enrichment');
  const processBtn = ref('btn-process-enrichment');

  // Clone buttons to remove any existing event listeners
  if (closeBtn) {
    closeBtn.replaceWith(closeBtn.cloneNode(true));
    clearRef('enrichment-modal'); // Clear cache so querySelector gets new element
  }
  if (cancelBtn) {
    cancelBtn.replaceWith(cancelBtn.cloneNode(true));
    clearRef('btn-cancel-enrichment');
  }
  if (saveBtn) {
    saveBtn.replaceWith(saveBtn.cloneNode(true));
    clearRef('btn-save-enrichment');
  }
  if (processBtn) {
    processBtn.replaceWith(processBtn.cloneNode(true));
    clearRef('btn-process-enrichment');
  }

  // Re-get references after cloning
  const newCloseBtn = ref('enrichment-modal')?.querySelector('.modal__close');
  const newCancelBtn = ref('btn-cancel-enrichment');
  const newSaveBtn = ref('btn-save-enrichment');
  const newProcessBtn = ref('btn-process-enrichment');

  const close = () => {
    hideEnrichmentModal();
    onCancel?.();
  };

  newCloseBtn?.addEventListener('click', close);
  newCancelBtn?.addEventListener('click', close);

  // Geocode preview
  ref('btn-geocode-preview')?.addEventListener('click', async () => {
    const address = getValue('enrichment-address');
    if (!address) {
      showToast('Моля, въведете адрес.', { type: 'error' });
      return;
    }
    await runGeocodePreview(address);
  });

  // Refresh weather
  ref('btn-refresh-weather')?.addEventListener('click', async () => {
    const address = getValue('enrichment-address-validated') || getValue('enrichment-address');
    const date = getValue('enrichment-date');
    const time = getValue('enrichment-time');
    if (!address || !date) {
      showToast('Моля, въведете адрес и дата.', { type: 'error' });
      return;
    }
    await runWeatherPreview(address, date, time);
  });

  // AI Validate address - now uses real AI if configured
  ref('btn-validate-address')?.addEventListener('click', async () => {
    const address = getValue('enrichment-address');
    if (!address) {
      showToast('Моля, въведете адрес.', { type: 'error' });
      return;
    }
    
    const validateBtn = ref('btn-validate-address');
    setBusy(validateBtn, true, 'AI валидация...');
    
    try {
      const { validateAddressWithAI } = await import('../core/ai.js');
      const corrected = await validateAddressWithAI(address, categoryId);
      
      if (corrected) {
        setValue('enrichment-address-validated', corrected);
        showToast('Адресът е коректиран от AI!', { type: 'success' });
        await runGeocodePreview(corrected);
      } else {
        showToast('AI не е конфигуриран или е неуспешен. Използва се директно въведеният адрес.', { type: 'info' });
        setValue('enrichment-address-validated', address);
        await runGeocodePreview(address);
      }
    } catch (error) {
      console.error('AI validation error:', error);
      showToast('Грешка при AI валидация.', { type: 'error' });
    } finally {
      setBusy(validateBtn, false);
    }
  });

  // AI Test connection
  ref('btn-test-ai')?.addEventListener('click', async () => {
    await testAIConnection(categoryId);
  });

  // AI Save settings
  ref('btn-save-ai')?.addEventListener('click', async () => {
    const { saveAISettings } = await import('../core/ai.js');
    const settings = collectAISettings();
    const saved = await saveAISettings(categoryId, settings);
    if (saved) {
      showToast('AI настройките са запазени за тази категория!', { type: 'success' });
    } else {
      showToast('Грешка при запазване на AI настройки.', { type: 'error' });
    }
  });

  // Save configuration
  newSaveBtn?.addEventListener('click', () => {
    const config = collectEnrichmentConfig();
    hideEnrichmentModal();
    onSave?.(config);
  });

  // Process category
  newProcessBtn?.addEventListener('click', () => {
    console.log('🔵 [enrichment-modal] Process button clicked');
    const config = collectEnrichmentConfig();
    console.log('🔵 [enrichment-modal] Collected config:', config);
    const categoryId = ref('enrichment-modal')?.dataset?.categoryId;
    console.log('🔵 [enrichment-modal] categoryId from modal:', categoryId);
    hideEnrichmentModal();
    onProcess?.(config);
  });

  // Close on backdrop click
  const backdrop = ref('enrichment-modal')?.querySelector('.modal__backdrop');
  backdrop?.addEventListener('click', close);

  // Close on Escape
  const escapeHandler = (e) => {
    if (e.key === 'Escape' && !ref('enrichment-modal').hidden) {
      close();
      document.removeEventListener('keydown', escapeHandler);
    }
  };
  document.addEventListener('keydown', escapeHandler);
}

/** Collect enrichment configuration from form. */
function collectEnrichmentConfig() {
  console.log('🔵 [collectEnrichmentConfig] === START ===');
  const numberPositionRadio = document.querySelector('input[name="enrichment-number-position"]:checked');
  const onlyDigitConfig = getOnlyDigitConfig();
  const config = {
    address: getValue('enrichment-address'),
    addressValidated: getValue('enrichment-address-validated'),
    date: getValue('enrichment-date'),
    time: getValue('enrichment-time'),
    watermarkMode: getValue('enrichment-watermark-mode'),
    numberPosition: numberPositionRadio?.value || 'bottom-right',
    onlyDigit: onlyDigitConfig
  };
  console.log('🔵 [collectEnrichmentConfig] Collected config:', config);
  return config;
}

/** Run geocode preview for address. */
async function runGeocodePreview(address) {
  const preview = ref('enrichment-geocode-preview');
  const status = ref('weather-status');
  
  // Show loading
  setText(ref('preview-latlon-decimal'), 'Зареждане...');
  setText(ref('preview-latlon-dms'), 'Зареждане...');
  setText(ref('preview-address'), 'Зареждане...');
  setText(ref('preview-displayname'), 'Зареждане...');
  setText(ref('preview-confidence'), 'Зареждане...');
  show(preview, true);
  if (status) setText(status, 'Геокодиране на адреса...');

  try {
    // Use the enricher (will be imported dynamically)
    const { GeoWeatherEnricher, toDMS } = await import('../core/geo-weather-enricher.js');
    const enricher = new GeoWeatherEnricher({
      nominatimProxyUrl: '/.netlify/functions/geocode'
    });
    
    const location = await enricher.resolveLocation(address);
    
    if (!location) {
      throw new Error('Неуспешно геокодиране');
    }

    // Update preview
    setText(ref('preview-latlon-decimal'), `${location.lat.toFixed(6)}, ${location.lon.toFixed(6)}`);
    setText(ref('preview-latlon-dms'), `${toDMS(location.lat, true)}, ${toDMS(location.lon, false)}`);
    setText(ref('preview-address'), location.address || '—');
    setText(ref('preview-displayname'), location.displayName || '—');
    setText(ref('preview-confidence'), `${Math.round(location.confidence * 100)}%`);
    
    // Store validated address
    if (location.address) {
      setValue('enrichment-address-validated', location.address);
    }
    
    // Trigger weather preview if date is set
    const date = getValue('enrichment-date');
    const time = getValue('enrichment-time');
    if (date) {
      await runWeatherPreview(location.address || address, date, time);
    } else {
      if (status) setText(status, 'Координати са намерени. Изберете дата за да се извлечат метео данни.');
      show(ref('btn-refresh-weather'), true);
    }
  } catch (error) {
    console.error('Geocode preview error:', error);
    setText(ref('preview-latlon-decimal'), 'Грешка');
    setText(ref('preview-latlon-dms'), 'Грешка');
    setText(ref('preview-address'), 'Грешка при геокодиране');
    if (status) setText(status, `Грешка: ${error.message}`);
  }
}

/** Run weather preview for location + date + time. */
async function runWeatherPreview(address, date, time) {
  const status = ref('weather-status');
  setText(ref('preview-temperature'), 'Зареждане...');
  setText(ref('preview-humidity'), 'Зареждане...');
  if (status) setText(status, 'Извличане на метео данни...');
  show(ref('btn-refresh-weather'), true);

  try {
    const { GeoWeatherEnricher, toDMS } = await import('../core/geo-weather-enricher.js');
    const enricher = new GeoWeatherEnricher({
      nominatimProxyUrl: '/.netlify/functions/geocode'
    });

    const location = await enricher.resolveLocation(address);
    if (!location) throw new Error('Невалидни координати');

    const weather = await enricher.getWeather(location.lat, location.lon, date, time);
    
    if (weather) {
      setText(ref('preview-temperature'), `${weather.temp} °C`);
      setText(ref('preview-humidity'), weather.humidity !== null ? `${weather.humidity} %` : '—');
      if (status) setText(status, `Метео данни за ${date} ${time || '12:00'}: ${weather.temp}°C, ${weather.humidity !== null ? weather.humidity + '%' : 'няма данни за влажност'}`);
    } else {
      setText(ref('preview-temperature'), 'Няма данни');
      setText(ref('preview-humidity'), 'Няма данни');
      if (status) setText(status, 'Няма налични метео данни за избраната дата/час.');
    }
  } catch (error) {
    console.error('Weather preview error:', error);
    setText(ref('preview-temperature'), 'Грешка');
    setText(ref('preview-humidity'), 'Грешка');
    if (status) setText(status, `Грешка при извличане на метео: ${error.message}`);
  }
}

/* ------------------------------ AI Settings (UI) ------------------------------ */

/** Load AI settings into form (with categoryId for per-category settings). */
async function loadAIForm(categoryId = null) {
  const { loadUserSettings, loadCategoryPrompt, getGlobalDefaults } = await import('../core/ai.js');
  
  // Load user global settings (endpoint, model) and category-specific prompt in parallel
  const [userSettings, categoryPrompt, defaults] = await Promise.all([
    loadUserSettings(),
    loadCategoryPrompt(categoryId),
    getGlobalDefaults()
  ]);
  
  // Set form values
  setValue('ai-endpoint', userSettings.endpoint);
  setValue('ai-model', userSettings.model);
  setValue('ai-prompt', categoryPrompt);
  
  // Set placeholders to show built-in defaults as hints
  setPlaceholder('ai-endpoint', defaults.endpoint);
  setPlaceholder('ai-model', defaults.model);
  setPlaceholder('ai-prompt', defaults.prompt.substring(0, 100) + '...');
}

/** Set placeholder on element. */
function setPlaceholder(id, value) {
  const el = ref(id);
  if (el && value) {
    el.placeholder = value;
  }
}

/** Collect AI settings from form (only non-empty fields). */
function collectAISettings() {
  return {
    endpoint: getValue('ai-endpoint') || undefined,
    model: getValue('ai-model') || undefined,
    prompt: getValue('ai-prompt') || undefined
  };
}

/** Test AI connection for a category. */
async function testAIConnection(categoryId = null) {
  const testBtn = ref('btn-test-ai');
  const output = ref('ai-test-output');
  const resultDiv = ref('ai-test-result');
  
  if (!testBtn) return;
  
  const { testAIConnection: testAI } = await import('../core/ai.js');
  
  setBusy(testBtn, true, 'Тестване...');
  show(resultDiv, false);
  
  try {
    const result = await testAI(categoryId);
    
    show(resultDiv, true);
    output.textContent = `Тестов адрес: ${result.testAddress}\n\nКоригиран: ${result.corrected}\n\n✅ AI връзката работи коректно!\nМодел: ${result.settingsUsed.model}\nEndpoint: ${result.settingsUsed.endpoint}`;
    
    showToast('AI тест успешен!', { type: 'success' });
  } catch (error) {
    show(resultDiv, true);
    output.textContent = `Грешка: ${error.message}`;
    showToast(`AI тест неуспешен: ${error.message}`, { type: 'error' });
  } finally {
    setBusy(testBtn, false);
  }
}

/* ------------------------------ Navigation ------------------------------ */

/** Switch main view. */
export function switchView(viewName) {
  const views = ['main-view', 'gallery-view', 'category-view', 'step-view', 'settings-view', 'help-view'];
  for (const view of views) {
    const el = ref(view);
    if (el) el.hidden = view !== `${viewName}-view`;
  }

  // Update nav buttons
  const navButtons = ['nav-main', 'nav-gallery', 'nav-categories', 'nav-settings', 'nav-help'];
  for (const btnId of navButtons) {
    const btn = ref(btnId);
    if (btn) toggleClass(btn, 'nav-btn--active', btnId === `nav-${viewName}`);
  }
}

/* ------------------------------ Utility ------------------------------ */

/** Generate a simple ID. */
export function generateId() {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Create a file download link. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = createElement('a', { href: url, download: filename, style: 'display:none' });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Download multiple blobs as a ZIP (requires JSZip - optional). */
export async function downloadAsZip(files, zipName) {
  // This would require JSZip library - for now just download individually
  for (const { blob, filename } of files) {
    downloadBlob(blob, filename);
    await new Promise((r) => setTimeout(r, 100)); // Small delay between downloads
  }
}

/* ------------------------------ Image Preview Modal ------------------------------ */

/** Initialize image preview modal event listeners. */
export function initImagePreview() {
  const modal = ref('image-preview-modal');
  const closeBtn = ref('image-preview-modal-close');
  const backdrop = modal?.querySelector('.image-preview-modal__backdrop');
  const imageEl = ref('image-preview-modal-image');

  if (!modal || !closeBtn || !backdrop || !imageEl) {
    console.warn('[initImagePreview] Modal elements not found');
    return;
  }

  // Close on backdrop click
  backdrop.addEventListener('click', closeImagePreview);

  // Close on close button click
  closeBtn.addEventListener('click', closeImagePreview);

  // Close on image click (click on the large image to close)
  imageEl.addEventListener('click', closeImagePreview);

  // Close on Escape key
  const handleKeydown = (e) => {
    if (e.key === 'Escape' && modal.classList.contains('image-preview-modal--open')) {
      closeImagePreview();
    }
  };
  document.addEventListener('keydown', handleKeydown);

  // Store cleanup function on modal for potential future use
  modal._cleanupImagePreview = () => {
    document.removeEventListener('keydown', handleKeydown);
  };

  console.log('[initImagePreview] Image preview modal initialized');
}

/** Open image preview modal with full-resolution image. */
export function openImagePreview(photo) {
  const modal = ref('image-preview-modal');
  const imageEl = ref('image-preview-modal-image');

  if (!modal || !imageEl || !photo) {
    console.warn('[openImagePreview] Missing elements or photo');
    return;
  }

  // Create object URL for the full-resolution image
  const objectUrl = URL.createObjectURL(photo.file);
  
  // Store the object URL on the element for cleanup
  imageEl.dataset.objectUrl = objectUrl;
  
  // Set image source and alt
  imageEl.src = objectUrl;
  imageEl.alt = photo.filename || 'Preview';

  // Show modal with animation
  modal.hidden = false;
  // Force reflow for animation
  modal.offsetHeight;
  modal.classList.add('image-preview-modal--open');

  // Prevent body scroll
  document.body.style.overflow = 'hidden';

  console.log('[openImagePreview] Opened preview for:', photo.filename);
}

/** Close image preview modal. */
export function closeImagePreview() {
  const modal = ref('image-preview-modal');
  const imageEl = ref('image-preview-modal-image');

  if (!modal || !imageEl) return;

  // Revoke object URL to free memory
  if (imageEl.dataset.objectUrl) {
    URL.revokeObjectURL(imageEl.dataset.objectUrl);
    delete imageEl.dataset.objectUrl;
  }

  // Clear image source
  imageEl.src = '';
  imageEl.alt = '';

  // Hide modal with animation
  modal.classList.remove('image-preview-modal--open');
  
  // Wait for transition to complete before hiding
  setTimeout(() => {
    if (!modal.classList.contains('image-preview-modal--open')) {
      modal.hidden = true;
      document.body.style.overflow = '';
    }
  }, 250); // Match transition duration

  console.log('[closeImagePreview] Closed preview');
}

/** Check if image preview is currently open. */
export function isImagePreviewOpen() {
  const modal = ref('image-preview-modal');
  return modal?.classList.contains('image-preview-modal--open') ?? false;
}