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
    'category-list', 'btn-add-category', 'btn-export-categories', 'btn-import-categories', 'btn-process-category',
    'watermark-mode-selector', 'watermark-mode-full', 'watermark-mode-numberOnly',
    'number-position-options', 'number-position-top-left', 'number-position-top-right',
    'number-position-bottom-left', 'number-position-bottom-right',
    'category-modal', 'category-form',
    'category-name', 'category-description', 'category-order',
    'btn-save-category', 'btn-cancel-category', 'btn-delete-category',
    // Step management
    'step-list', 'btn-add-step', 'btn-back-category', 'step-modal', 'step-form',
    'step-name', 'step-description', 'step-message', 'step-photos-required', 'step-order',
    'btn-save-step', 'btn-cancel-step', 'btn-delete-step',
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

/* ------------------------------ Gallery View ------------------------------ */

/** Render the gallery grid. */
export function renderGallery(photos, { selectedPhotoIds = [], onSelect, onClick, onAssign, onDelete, categories = [] } = {}) {
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

  // Click to view full size (only on card, not on buttons/checkbox)
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
        const photoCard = createElement('div', {
          class: 'step-photo-card',
          draggable: true,
          // Keep local position in dataset for drag-and-drop reordering logic
          dataset: { id: photo.id, stepId: step.id, position: localPosition },
        },
          // Show global position in badge so user sees the actual watermark number
          createElement('span', { class: 'step-photo-card__position' }, `${globalPosition}`),
          createElement('img', {
            class: 'step-photo-card__img',
            src: photo.thumbnailUrl || URL.createObjectURL(photo.thumbnail || photo.file),
            alt: photo.filename,
            loading: 'lazy',
          }),
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
  const applyBtn = ref('btn-apply-quick-watermark');
  const cancelBtn = ref('btn-cancel-quick-watermark');

  if (!modal || !grid) return;

  // Populate position radio buttons
  if (positionEl) {
    const positionRadios = positionEl.querySelectorAll('input[name="quick-watermark-position"]');
    positionRadios.forEach(radio => {
      radio.checked = radio.value === currentPosition;
    });
  }

  grid.innerHTML = '';
  updateQuickWatermarkCount(selectedIds.length);

  // Render selected photos in selection order (1, 2, 3...)
  for (let i = 0; i < selectedIds.length; i++) {
    const photoId = selectedIds[i];
    const photo = photos.find(p => p.id === photoId);
    if (!photo) continue;

    const card = createElement('div', {
      class: 'quick-watermark-card',
      dataset: { id: photo.id },
    },
      createElement('span', { class: 'quick-watermark-card__number' }, `#${i + 1}`),
      createElement('img', {
        class: 'quick-watermark-card__img',
        src: photo.thumbnailUrl || URL.createObjectURL(photo.thumbnail || photo.file),
        alt: photo.filename,
        loading: 'lazy',
      }),
      createElement('span', { class: 'quick-watermark-card__name' }, photo.filename)
    );
    grid.appendChild(card);
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

  applyBtn.onclick = () => {
    const position = getSelectedPosition();
    modal.hidden = true;
    onApply?.(selectedIds, position);
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

/** Show/hide watermark mode selector in category view. */
export function showWatermarkModeSelector(visible) {
  const selector = ref('watermark-mode-selector');
  if (selector) {
    selector.hidden = !visible;
  }
}

/** Load watermark mode settings into selector. */
export function loadWatermarkModeSettings(settings) {
  // Watermark mode
  if (settings.watermarkMode) {
    const modeRadio = document.querySelector(`input[name="watermark-mode"][value="${settings.watermarkMode}"]`);
    if (modeRadio) modeRadio.checked = true;
  }
  // Number position
  if (settings.numberPosition) {
    const posRadio = document.querySelector(`input[name="number-position"][value="${settings.numberPosition}"]`);
    if (posRadio) posRadio.checked = true;
  }
  // Show/hide number position options based on mode
  const numberOnlyRadio = document.getElementById('watermark-mode-numberOnly');
  const numberPositionOptions = document.getElementById('number-position-options');
  if (numberOnlyRadio && numberPositionOptions) {
    numberPositionOptions.hidden = !numberOnlyRadio.checked;
  }
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