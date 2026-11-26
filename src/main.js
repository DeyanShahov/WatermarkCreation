/**
 * Watermark Creation - Main entry point and orchestration.
 *
 * Flow:
 * 1. Load photos into gallery
 * 2. Create categories and steps
 * 3. Assign photos to steps (with position numbers)
 * 4. Apply watermarks with all metadata
 * 5. Download processed photos
 */

import { getState, setState, subscribe } from './state.js';
import * as ui from './modules/ui.js';
import { clearRef } from './modules/ui.js';
import * as storage from './modules/storage.js';
import * as watermark from './modules/watermark.js';
import * as qr from './modules/qr.js';
import * as geocode from './modules/geocode.js';
import * as archive from './modules/archive.js';
import * as exif from './modules/exif.js';
import { fetchWeather } from './utils/weather.js';
import { formatDateTime, makePhotoFilename } from './utils/coords.js';
import { createThumbnail } from './utils/image.js';

// Make togglePasswordVisibility globally available for HTML onclick handlers
window.togglePasswordVisibility = ui.togglePasswordVisibility;

let refs;

// App version - update this when making changes
const APP_VERSION = '1.2.0';

const DEFAULT_WATERMARK_SETTINGS = {
  showCoordinates: true,
  showAltitude: true,
  showDateTime: true,
  showAddress: true,
  showWeather: true,
  showQrCode: true,
  showPhotoNumber: true,
  showCategoryStep: true,
  showDescription: true,
  maxEdge: 4096,
  quality: 0.92,
  // Watermark mode settings
  watermarkMode: 'full', // 'full' | 'numberOnly'
  numberPosition: 'top-left', // 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
};

/* ------------------------------------------------------------------ State initialization */

function initState() {
  setState({
    currentView: 'main',
    photos: [],
    selectedPhotoIds: [],
    categories: [],
    currentCategory: null,
    currentStep: null,
    watermarkSettings: { ...DEFAULT_WATERMARK_SETTINGS },
    isProcessing: false,
    lastKnownFix: null,
    lastKnownAddress: null,
  });
  loadSavedData();
}

/* ------------------------------------------------------------------ Data loading */

async function loadSavedData() {
  try {
    // First, load categories from IndexedDB
    let categories = await storage.getCategories();
    
    // If no categories in IndexedDB, try to load from local JSON archive
    if (!categories || categories.length === 0) {
      console.log('🔵 [loadSavedData] No categories in IndexedDB, trying local archive...');
      const archivedCategories = await archive.tryLoadLocalArchive();
      if (archivedCategories && archivedCategories.length > 0) {
        console.log('🔵 [loadSavedData] Found', archivedCategories.length, 'categories in local archive, importing...');
        // Import archived categories with new IDs
        for (const cat of archivedCategories) {
          const newCat = { ...cat, id: ui.generateId(), steps: (cat.steps || []).map(s => ({ ...s, id: ui.generateId() })) };
          await storage.saveCategory(newCat);
        }
        categories = await storage.getCategories();
        ui.showToast(`Заредени ${categories.length} категории от локален архив.`, { type: 'info' });
      }
    }
    
    setState({ categories });

    // Remove AI settings left behind by categories that no longer exist
    // (archive imports generate new category IDs, which orphans old keys).
    try {
      const removedOrphans = await storage.cleanupOrphanCategoryAISettings();
      if (removedOrphans > 0) {
        console.log(`🧹 [loadSavedData] Removed ${removedOrphans} orphaned AI setting(s)`);
      }
    } catch (error) {
      console.warn('🔵 [loadSavedData] Orphan AI settings cleanup failed:', error);
    }

    const savedSettings = await storage.getSetting('watermarkSettings');
    if (savedSettings) {
      setState({ watermarkSettings: { ...DEFAULT_WATERMARK_SETTINGS, ...savedSettings } });
      ui.loadWatermarkSettings(getState().watermarkSettings);
    }
    await refreshGallery();
  } catch (error) {
    console.error('Failed to load saved data:', error);
    ui.showToast('Грешка при зареждане на данните', { type: 'error' });
  }
}

async function refreshGallery() {
  console.log('🔵 [refreshGallery] Called');
  const photos = await storage.getPhotos();
  console.log('🔵 [refreshGallery] Got photos from storage:', photos.length);
  const photosWithUrls = photos.map((photo) => {
    // Explicitly exclude any legacy 'selected' property from stored photos
    const { selected, ...rest } = photo;
    return {
      ...rest,
      thumbnailUrl: photo.thumbnail ? URL.createObjectURL(photo.thumbnail) : null,
      fileUrl: photo.file ? URL.createObjectURL(photo.file) : null,
    };
  });
  console.log('🔵 [refreshGallery] Created URLs for', photosWithUrls.length, 'photos');
  // Clear selection when loading new photos - setState will trigger renderAll via subscription
  setState({ photos: photosWithUrls, selectedPhotoIds: [] });
  updateSelectedCount();
  console.log('🔵 [refreshGallery] Done (state updated, renderAll will handle rendering)');
}

/* ------------------------------------------------------------------ Photo selection */

function handlePhotoSelect(photoId, selected) {
  const { selectedPhotoIds } = getState();
  const newSelected = selected
    ? [...selectedPhotoIds, photoId]
    : selectedPhotoIds.filter((id) => id !== photoId);
  setState({ selectedPhotoIds: newSelected });
  updateSelectedCount();
}

function updateSelectedCount() {
  const count = getState().selectedPhotoIds.length;
  const countEl = refs['gallery-count'];
  if (countEl) countEl.textContent = count;
}

function handlePhotoClick(photo) {
  // Open full-size image preview on double-click (handled in UI)
  // Single click on card does nothing - only double-click on image opens preview
}

function handlePhotoAssign(photoId) {
  const { currentCategory, currentStep } = getState();
  if (!currentCategory || !currentStep) {
    ui.showToast('Моля, първо изберете категория и стъпка', { type: 'warning' });
    return;
  }
  showPhotoSelectionModal(currentCategory.id, currentStep.id);
}

async function handleDeletePhoto(photoId) {
  if (!confirm('Сигурни ли сте, че искате да изтриете тази снимка?')) return;
  try {
    await storage.deletePhoto(photoId);
    // Remove from state - setState will trigger renderAll via subscription
    const photos = getState().photos.filter((p) => p.id !== photoId);
    const selectedPhotoIds = getState().selectedPhotoIds.filter((id) => id !== photoId);
    setState({ photos, selectedPhotoIds });
    updateSelectedCount();
    ui.showToast('Снимката е изтрита', { type: 'success' });
  } catch (error) {
    console.error('Failed to delete photo:', error);
    ui.showToast('Грешка при изтриване на снимката', { type: 'error' });
  }
}

function handleSelectAllPhotos() {
  const { photos } = getState();
  if (!photos || photos.length === 0) {
    ui.showToast('Няма снимки за маркиране', { type: 'warn' });
    return;
  }
  const allIds = photos.map((p) => p.id);
  setState({ selectedPhotoIds: allIds });
  // Re-render gallery to update checkboxes
  ui.renderGallery(photos, {
    selectedPhotoIds: allIds,
    onSelect: handlePhotoSelect,
    onClick: handlePhotoClick,
    onAssign: handlePhotoAssign,
    onDelete: handleDeletePhoto,
  });
  updateSelectedCount();
  ui.showToast(`Маркирани ${allIds.length} снимки`, { type: 'success' });
}

function handleDeselectAllPhotos() {
  const { photos } = getState();
  if (!photos || photos.length === 0) {
    ui.showToast('Няма снимки за демаркиране', { type: 'warn' });
    return;
  }
  setState({ selectedPhotoIds: [] });
  // Re-render gallery to update checkboxes
  ui.renderGallery(photos, {
    selectedPhotoIds: [],
    onSelect: handlePhotoSelect,
    onClick: handlePhotoClick,
    onAssign: handlePhotoAssign,
    onDelete: handleDeletePhoto,
  });
  updateSelectedCount();
  ui.showToast('Всички снимки са демаркирани', { type: 'success' });
}

async function handleDeleteAllPhotos() {
  const { photos } = getState();
  if (!photos || photos.length === 0) {
    ui.showToast('Няма снимки за изтриване', { type: 'warn' });
    return;
  }
  const count = photos.length;
  if (!confirm(`Сигурни ли сте, че искате да изтриете ВСИЧКИ ${count} снимки? Това действие не може да бъде отменено.`)) return;
  
  ui.showToast('Изтриване на снимки...', { type: 'info' });
  let deletedCount = 0;
  for (const photo of photos) {
    try {
      await storage.deletePhoto(photo.id);
      deletedCount++;
    } catch (error) {
      console.error('Failed to delete photo:', photo.id, error);
    }
  }
  
  // Clear state
  setState({ photos: [], selectedPhotoIds: [] });
  updateSelectedCount();
  ui.showToast(`Изтрити ${deletedCount} от ${count} снимки`, { type: 'success' });
}

/* ------------------------------------------------------------------ Photo loading */

async function handleLoadPhotos() {
  console.log('🔵 [handleLoadPhotos] Clicked - creating file input');
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.onchange = async (e) => {
    const files = Array.from(e.target.files);
    console.log('🔵 [handleLoadPhotos] onchange fired, files:', files.length, files.map(f => f.name));
    if (files.length === 0) {
      console.log('🔵 [handleLoadPhotos] No files selected');
      return;
    }
    ui.showToast('Зареждане на ' + files.length + ' снимки...', { type: 'info' });
    const { currentCategory, currentStep } = getState();
    console.log('🔵 [handleLoadPhotos] currentCategory:', currentCategory?.name, currentCategory?.id, 'currentStep:', currentStep?.name, currentStep?.id);
    for (const file of files) {
      try {
        const metadata = {
          categoryId: currentCategory?.id || null,
          stepId: currentStep?.id || null,
          position: null,
        };
        console.log('🔵 [handleLoadPhotos] Creating photo record for:', file.name, metadata);
        const photoRecord = await storage.createPhotoRecord(file, metadata);
        console.log('🔵 [handleLoadPhotos] Photo record created:', photoRecord.id);
        await storage.savePhoto(photoRecord);
        console.log('🔵 [handleLoadPhotos] Photo saved to IndexedDB');
      } catch (error) {
        console.error('🔴 [handleLoadPhotos] Failed to load photo:', file.name, error);
        ui.showToast('Грешка при зареждане на ' + file.name, { type: 'error' });
      }
    }
    console.log('🔵 [handleLoadPhotos] Refreshing gallery...');
    await refreshGallery();
    ui.showToast('Снимките са заредени', { type: 'success' });
  };
  console.log('🔵 [handleLoadPhotos] Calling input.click()...');
  input.click();
}

/* ------------------------------------------------------------------ Category management */

function handleAddCategory() {
  ui.showCategoryModal({
    onSave: async (data) => {
      const categories = getState().categories;
      const newCategory = { ...data, order: categories.length, steps: [] };
      await storage.saveCategory(newCategory);
      const updated = [...categories, newCategory];
      setState({ categories: updated });
      ui.showToast('Категорията е създадена', { type: 'success' });
    },
  });
}

function handleCategorySelect(category) {
  setState({ currentCategory: category, currentStep: null, currentView: 'step' });
  ui.switchView('step');
  ui.renderSteps(category, {
    onSelect: handleStepSelect,
    onEdit: handleEditStep,
    onDelete: handleDeleteStep,
    onReorder: handleReorderSteps,
    onAssignPhotos: handleAssignPhotosToStep,
    photos: getState().photos,
    onReorderPhotos: handleReorderPhotos,
    onPreview: (photo) => ui.openImagePreview(photo),  // Double-click to open full-size preview
  });
}

function handleEditCategory(category) {
  ui.showCategoryModal({
    category,
    onSave: async (data) => {
      const updated = { ...category, ...data };
      await storage.saveCategory(updated);
      const categories = getState().categories.map((c) => (c.id === category.id ? updated : c));
      setState({ categories, currentCategory: updated });
      ui.showToast('Категорията е обновена', { type: 'success' });
    },
  });
}

async function handleDeleteCategory() {
  const { currentCategory, photos } = getState();
  if (!currentCategory) return;
  if (!confirm('Сигурни ли сте? Всички стъпки и снимки в тази категория ще бъдат изтрити.')) return;
  
  // Find photos assigned to this category and clear their assignment
  const photosToUpdate = photos.filter(p => p.categoryId === currentCategory.id);
  for (const photo of photosToUpdate) {
    await storage.updatePhoto(photo.id, { 
      categoryId: null, 
      stepId: null, 
      position: null 
    });
  }
  
  // Delete the category. This also removes its AI settings (API key / prompt)
  // from the `category-prompts` store - see storage.deleteCategory().
  try {
    await storage.deleteCategory(currentCategory.id);
  } catch (error) {
    console.error('🔴 [handleDeleteCategory] Failed to delete category:', error);
    ui.showToast(`Грешка при изтриване на категорията: ${error.message}`, { type: 'error' });
    return;
  }

  // Update local state - clear assignments for affected photos
  const updatedPhotos = photos.map(p => 
    p.categoryId === currentCategory.id ? { ...p, categoryId: null, stepId: null, position: null } : p
  );
  
  const categories = getState().categories.filter((c) => c.id !== currentCategory.id);
  setState({ 
    categories, 
    currentCategory: null, 
    currentStep: null,
    photos: updatedPhotos
  });
  ui.showToast('Категорията е изтрита (включително AI настройки)', { type: 'success' });
}

function handleReorderCategories(categoryIds) {
  storage.reorderCategories(categoryIds);
  const categories = getState().categories.map((c, i) => ({ ...c, order: categoryIds.indexOf(c.id) }));
  setState({ categories });
}

/* ------------------------------------------------------------------ Category Processing */

/**
 * Handle process category from step view - shows enrichment modal first.
 */
async function handleProcessCategoryFromStep() {
  const { currentCategory, photos, watermarkSettings } = getState();
  
  console.log('🔵 [handleProcessCategoryFromStep] === START ===');
  console.log('🔵 [handleProcessCategoryFromStep] currentCategory:', currentCategory ? { id: currentCategory.id, name: currentCategory.name, steps: currentCategory.steps?.map(s => ({ id: s.id, name: s.name })) } : null);
  console.log('🔵 [handleProcessCategoryFromStep] photos count:', photos?.length || 0);
  console.log('🔵 [handleProcessCategoryFromStep] watermarkSettings:', watermarkSettings);
  
  if (!currentCategory) {
    ui.showToast('Моля, първо изберете категория', { type: 'warn' });
    return;
  }

  const steps = currentCategory.steps || [];
  if (steps.length === 0) {
    ui.showToast('Категорията няма стъпки', { type: 'warn' });
    return;
  }

  // Get valid step IDs for this category
  const validStepIds = new Set(steps.map(s => s.id));

  // Validation: check if all steps have minimum required photos
  // Use same filtering as processCategoryPhotos - only photos with valid stepId
  const validationErrors = [];
  for (const step of steps) {
    const stepPhotos = photos.filter(p => p.stepId === step.id && validStepIds.has(p.stepId));
    console.log(`🔵 [handleProcessCategoryFromStep] Step "${step.name}" (id: ${step.id}): ${stepPhotos.length} photos, required: ${step.photosRequired || 0}`);
    if (stepPhotos.length < (step.photosRequired || 0)) {
      validationErrors.push(`Стъпка "${step.name}": ${stepPhotos.length}/${step.photosRequired} снимки`);
    }
  }

  if (validationErrors.length > 0) {
    const message = 'Не всички стъпки имат минималния брой снимки:\n' + validationErrors.join('\n');
    if (!confirm(`${message}\n\nЖелаете ли да продължите въпреки това?`)) {
      return;
    }
  }

  // Show enrichment modal
  console.log('🔵 [handleProcessCategoryFromStep] Opening enrichment modal for category:', currentCategory.name);
  ui.showEnrichmentModal({
    category: currentCategory,
    step: currentCategory.steps?.[0] || null,
    onSave: async (config) => {
      console.log('🔵 [handleProcessCategoryFromStep] onSave callback, config:', config);
      await saveCategoryEnrichment(currentCategory.id, config);
      ui.showToast('Конфигурацията е запазена', { type: 'success' });
    },
    onProcess: async (config) => {
      console.log('🔵 [handleProcessCategoryFromStep] onProcess callback, config:', config);
      console.log('🔵 [handleProcessCategoryFromStep] currentCategory:', { id: currentCategory.id, name: currentCategory.name });
      console.log('🔵 [handleProcessCategoryFromStep] photos for processing (from state):', photos?.length || 0);
      
      // Save enrichment config to category
      await saveCategoryEnrichment(currentCategory.id, config);
      // Merge enrichment settings with watermark settings
      const mergedSettings = { ...watermarkSettings, ...config };
      console.log('🔵 [handleProcessCategoryFromStep] mergedSettings:', mergedSettings);
      await processCategoryPhotos(currentCategory, photos, mergedSettings);
    },
    onCancel: () => {
      console.log('🔵 [handleProcessCategoryFromStep] onCancel callback');
      ui.showToast('Обработката е отменена', { type: 'info' });
    }
  });
}

/**
 * Save enrichment configuration to category.
 */
async function saveCategoryEnrichment(categoryId, enrichment) {
  const { categories } = getState();
  const categoryIndex = categories.findIndex(c => c.id === categoryId);
  if (categoryIndex === -1) return;

  const updatedCategory = {
    ...categories[categoryIndex],
    enrichment: {
      ...categories[categoryIndex]?.enrichment,
      ...enrichment,
      lastEnriched: new Date().toISOString()
    }
  };

  const updatedCategories = [...categories];
  updatedCategories[categoryIndex] = updatedCategory;
  
  await storage.saveCategory(updatedCategory);
  setState({ categories: updatedCategories, currentCategory: updatedCategory });
}

/* ------------------------------------------------------------------ Category Processing Core */

async function processCategoryPhotos(currentCategory, allPhotos, watermarkSettings) {
  console.log('🔵 [processCategoryPhotos] === START ===');
  console.log('🔵 [processCategoryPhotos] currentCategory:', currentCategory ? { id: currentCategory.id, name: currentCategory.name } : null);
  console.log('🔵 [processCategoryPhotos] allPhotos count:', allPhotos?.length || 0);
  console.log('🔵 [processCategoryPhotos] watermarkSettings:', watermarkSettings);
  
  const steps = currentCategory.steps || [];
  if (steps.length === 0) {
    ui.showToast('Категорията няма стъпки', { type: 'warn' });
    return;
  }

  // Get valid step IDs for this category
  const validStepIds = new Set(steps.map(s => s.id));
  console.log('🔵 [processCategoryPhotos] Valid step IDs:', Array.from(validStepIds));

  // Create a map of stepId -> array index for sorting (match UI gallery logic)
  const stepIndexMap = new Map();
  steps.forEach((step, index) => stepIndexMap.set(step.id, index));

  // Get all photos for this category that belong to a valid step, ordered by step array order and position
  // This matches the UI gallery rendering logic (renderGallery) which uses array order of steps
  console.log('🔵 [processCategoryPhotos] Filtering photos for categoryId:', currentCategory.id);
  const categoryPhotos = allPhotos
    .filter(p => p.categoryId === currentCategory.id && validStepIds.has(p.stepId))
    .sort((a, b) => {
      const stepIndexA = stepIndexMap.get(a.stepId) ?? 999;
      const stepIndexB = stepIndexMap.get(b.stepId) ?? 999;
      if (stepIndexA !== stepIndexB) return stepIndexA - stepIndexB;
      return (a.position || 0) - (b.position || 0);
    });

  console.log('🔵 [processCategoryPhotos] categoryPhotos found:', categoryPhotos.length);
  categoryPhotos.forEach((p, idx) => {
    const step = steps.find(s => s.id === p.stepId);
    console.log(`  ${idx + 1}. ${p.filename} - categoryId: ${p.categoryId}, stepId: ${p.stepId}, step: ${step?.name}, position: ${p.position}`);
  });

  if (categoryPhotos.length === 0) {
    ui.showToast('Няма снимки за обработка в тази категория (няма снимки с валидни стъпки)', { type: 'warn' });
    return;
  }

  // Check if Only Digit mode is configured (from enrichment)
  const onlyDigitConfig = watermarkSettings.onlyDigit;
  const isNumberOnlyMode = watermarkSettings.watermarkMode === 'numberOnly' || (onlyDigitConfig && onlyDigitConfig.numberingMode);
  
  // Determine number format: 'number' for just "1", "2", "3" or 'full' for "Снимка 1 от 5"
  const numberFormat = isNumberOnlyMode ? 'number' : 'full';

  console.log('🔵 [processCategoryPhotos] isNumberOnlyMode:', isNumberOnlyMode);
  console.log('🔵 [processCategoryPhotos] onlyDigitConfig:', onlyDigitConfig);
  console.log('🔵 [processCategoryPhotos] numberFormat:', numberFormat);

  ui.showProcessModal();
  setState({ isProcessing: true });

  const results = { success: 0, errors: 0 };
  const processedBlobs = {};
  let globalNumber = 1;

  // For group mode with step symbols, track step-specific numbering
  const stepNumberCounters = {};
  const stepSymbols = onlyDigitConfig?.stepSymbols || {};

  for (let i = 0; i < categoryPhotos.length; i++) {
    const photo = categoryPhotos[i];
    ui.updateProcessProgress({
      current: i + 1,
      total: categoryPhotos.length,
      status: `Обработка на ${photo.filename}...`,
      currentFile: `#${globalNumber} ${photo.filename}`,
    });

    try {
      const step = steps.find(s => s.id === photo.stepId);
      const categoryName = currentCategory.name;
      const stepName = step?.name || '';
      const stepMessage = step?.message || '';
      const stepDescription = step?.description || '';

      // Use enrichment data from category if available, otherwise fall back to EXIF
      const enrichment = currentCategory.enrichment || {};
      const hasEnrichment = enrichment && enrichment.lat && enrichment.lon;

      let gps = null;
      let dateTime = null;
      let address = null;
      let weather = null;

      if (hasEnrichment) {
        // Use enrichment data (address, coordinates, date/time, weather)
        gps = {
          latitude: enrichment.lat,
          longitude: enrichment.lon,
          altitude: enrichment.altitude || null
        };
        // Parse date and time from enrichment
        if (enrichment.date && enrichment.time) {
          dateTime = new Date(`${enrichment.date}T${enrichment.time}`);
        } else if (enrichment.date) {
          dateTime = new Date(enrichment.date);
        }
        address = enrichment.address || enrichment.displayName || null;
        if (enrichment.temperature !== undefined || enrichment.humidity !== undefined) {
          weather = {
            temperature: enrichment.temperature,
            humidity: enrichment.humidity
          };
        }
      } else {
        // Fallback to EXIF data
        const exifData = await exif.readExifData(photo.file);
        gps = exifData?.gps ?? null;
        dateTime = exifData?.dateTime ?? null;
        
        if (gps && watermarkSettings.showWeather) {
          weather = await fetchWeather(gps.latitude, gps.longitude).catch(() => null);
        }
        if (gps && watermarkSettings.showAddress) {
          address = await geocode.reverseGeocode(gps.latitude, gps.longitude).catch(() => null);
        }
      }

      let qrMatrix = null;
      if (watermarkSettings.showQrCode && gps) {
        const qrPayload = qr.qrPayloadForWatermark({
          latitude: gps.latitude,
          longitude: gps.longitude,
          altitude: gps.altitude,
          capturedAt: dateTime,
          address,
          temperature: weather?.temperature,
          humidity: weather?.humidity,
          photoNumber: globalNumber,
          totalPhotos: categoryPhotos.length,
          category: currentCategory.name,
          step: stepName,
          description: stepDescription,
          message: stepMessage,
        });
        qrMatrix = await qr.createQrMatrix(qrPayload);
      }

      let processedBlob;
      // Determine photo number/text based on mode
      let photoNumberText = globalNumber;
      let totalPhotosText = categoryPhotos.length;
      
      if (isNumberOnlyMode) {
        // Only Digit mode
        if (onlyDigitConfig?.numberingMode === 'group' && step && stepSymbols[step.id]) {
          // Group mode with step symbol - use the configured symbol for this step
          photoNumberText = stepSymbols[step.id];
        } else {
          // Sequential mode - use global number
          photoNumberText = globalNumber;
        }
        // For number-only mode, totalPhotos is not shown
        totalPhotosText = null;
      }

      if (isNumberOnlyMode) {
        processedBlob = await watermark.withWatermark(photo.file, {
          ...watermarkSettings,
          photoNumber: photoNumberText,
          totalPhotos: totalPhotosText,
          category: currentCategory.name,
          step: stepName,
          stepMessage: stepMessage, // Pass step message for potential inclusion
          showCoordinates: false,
          showAltitude: false,
          showDateTime: false,
          showAddress: false,
          showWeather: false,
          showQrCode: false,
          showCategoryStep: false,
          showDescription: false,
          numberPosition: onlyDigitConfig?.position || watermarkSettings.numberPosition,
          numberFormat: numberFormat, // 'number' for just "1", "2", "3"
          includeStepMessage: onlyDigitConfig?.includeMessage || false, // New option
        });
      } else {
        processedBlob = await watermark.withWatermark(photo.file, {
          ...watermarkSettings,
          fix: gps,
          address,
          capturedAt: dateTime,
          weather,
          qrMatrix,
          photoNumber: globalNumber,
          totalPhotos: categoryPhotos.length,
          category: currentCategory.name,
          step: stepName,
          description: stepDescription,
          stepMessage: stepMessage,
          numberPosition: watermarkSettings.numberPosition,
        });
      }

      const baseName = makePhotoFilename(new Date(), null, null, 'jpg').replace('.jpg', '');
      const filename = `${baseName}_#${globalNumber}.jpg`;
      processedBlobs[photo.id] = { blob: processedBlob.blob, filename };

      results.success++;
      globalNumber++;
      ui.addProcessResult(photo, true);

    } catch (error) {
      console.error('Processing error:', error);
      results.errors++;
      ui.addProcessResult(photo, false, error.message);
    }
  }

  setState({ processedBlobs });

  ui.finishProcessing(results);
  ui.showToast(`Обработка завършена: ${results.success} успешни, ${results.errors} грешки`, { type: 'success' });
  setState({ isProcessing: false });
}

/* ------------------------------------------------------------------ Archive (Export/Import) */

async function handleExportCategories() {
  const categories = getState().categories;
  if (!categories || categories.length === 0) {
    ui.showToast('Няма категории за експорт.', { type: 'warn' });
    return;
  }

  ui.showToast('Експортиране...', { type: 'info' });
  const result = await archive.exportCategories(categories);

  if (result.success) {
    const methodText = result.method === 'filesystem' ? 'запазен в избрания файл' : 'изтеглен като файл';
    ui.showToast(`Категориите са експортирани (${methodText}).`, { type: 'success' });
  } else {
    ui.showToast(`Грешка при експорт: ${result.error}`, { type: 'error' });
  }
}

async function handleImportCategories() {
  ui.showToast('Избор на файл за импорт...', { type: 'info' });
  const result = await archive.importCategories();

  if (!result.success) {
    if (result.error !== 'Файл не е избран.') {
      ui.showToast(`Грешка при импорт: ${result.error}`, { type: 'error' });
    }
    return;
  }

  const importedCategories = result.categories;
  if (!importedCategories || importedCategories.length === 0) {
    ui.showToast('Файлът не съдържа категории.', { type: 'warn' });
    return;
  }

  // Check for conflicts with existing categories
  const existingCategories = getState().categories;
  const existingNames = new Set(existingCategories.map(c => c.name.toLowerCase()));
  const conflicts = importedCategories.filter(c => existingNames.has(c.name.toLowerCase()));

  let categoriesToImport = importedCategories;
  if (conflicts.length > 0) {
    const conflictNames = conflicts.map(c => c.name).join(', ');
    const overwrite = confirm(
      `Съществуват категории с същите имена: ${conflictNames}.\n` +
      'Натиснете "OK" за да ги презапишете, или "Отказ" за да импортирате само новите.'
    );
    if (!overwrite) {
      categoriesToImport = importedCategories.filter(c => !existingNames.has(c.name.toLowerCase()));
    }
  }

  // Save imported categories to IndexedDB
  let importedCount = 0;
  for (const cat of categoriesToImport) {
    // Generate new IDs to avoid conflicts
    const newCat = { ...cat, id: ui.generateId(), steps: (cat.steps || []).map(s => ({ ...s, id: ui.generateId() })) };
    await storage.saveCategory(newCat);
    importedCount++;
  }

  // Reload categories from storage
  const updatedCategories = await storage.getCategories();
  setState({ categories: updatedCategories });
  ui.renderCategories(updatedCategories, {
    onSelect: handleCategorySelect,
    onEdit: handleEditCategory,
    onDelete: handleDeleteCategory,
    onReorder: handleReorderCategories,
  });

  ui.showToast(`Импортирани ${importedCount} категории.`, { type: 'success' });
}

/* ------------------------------------------------------------------ Step management */

function handleAddStep() {
  const { currentCategory } = getState();
  if (!currentCategory) return;
  ui.showStepModal({
    category: currentCategory,
    onSave: async (data) => {
      const steps = currentCategory.steps || [];
      const newStep = { id: ui.generateId(), ...data, photoIds: [] };
      const updatedCategory = { ...currentCategory, steps: [...steps, newStep] };
      await storage.saveCategory(updatedCategory);
      const categories = getState().categories.map((c) => (c.id === currentCategory.id ? updatedCategory : c));
      setState({ categories, currentCategory: updatedCategory });
      ui.showToast('Стъпката е създадена', { type: 'success' });
    },
  });
}

function handleStepSelect(step) {
  setState({ currentStep: step });
}

function handleEditStep(step) {
  const { currentCategory } = getState();
  if (!currentCategory) return;
  ui.showStepModal({
    category: currentCategory,
    step,
    onSave: async (data) => {
      const steps = currentCategory.steps.map((s) => (s.id === step.id ? { ...s, ...data } : s));
      const updatedCategory = { ...currentCategory, steps };
      await storage.saveCategory(updatedCategory);
      const categories = getState().categories.map((c) => (c.id === currentCategory.id ? updatedCategory : c));
      setState({ categories, currentCategory: updatedCategory, currentStep: updatedCategory.steps.find((s) => s.id === step.id) });
      ui.showToast('Стъпката е обновена', { type: 'success' });
    },
  });
}

async function handleDeleteStep(stepId) {
  const { currentCategory, photos } = getState();
  if (!currentCategory) return;
  
  // If stepId not provided, try to use currentStep from state
  const targetStepId = stepId || getState().currentStep?.id;
  if (!targetStepId) return;
  
  const targetStep = currentCategory.steps.find(s => s.id === targetStepId);
  if (!targetStep) return;
  
  if (!confirm('Сигурни ли сте? Всички присвоени снимки ще бъдат премахнати.')) return;
  
  // Find photos assigned to this step and clear their assignment
  const photosToUpdate = photos.filter(p => p.stepId === targetStepId);
  for (const photo of photosToUpdate) {
    await storage.updatePhoto(photo.id, { 
      categoryId: null, 
      stepId: null, 
      position: null 
    });
  }
  
  const steps = currentCategory.steps.filter((s) => s.id !== targetStepId);
  const updatedCategory = { ...currentCategory, steps };
  await storage.saveCategory(updatedCategory);
  
  // Update local state - clear assignments for affected photos
  const updatedPhotos = photos.map(p => 
    p.stepId === targetStepId ? { ...p, categoryId: null, stepId: null, position: null } : p
  );
  
  const categories = getState().categories.map((c) => (c.id === currentCategory.id ? updatedCategory : c));
  setState({ 
    categories, 
    currentCategory: updatedCategory, 
    currentStep: null,
    photos: updatedPhotos
  });
  ui.showToast('Стъпката е изтрита', { type: 'success' });
}

async function handleReorderSteps(stepIds) {
  const { currentCategory } = getState();
  if (!currentCategory) return;
  const steps = currentCategory.steps.map((s, i) => ({ ...s, order: stepIds.indexOf(s.id) }));
  const updatedCategory = { ...currentCategory, steps };
  await storage.saveCategory(updatedCategory);
  const categories = getState().categories.map((c) => (c.id === currentCategory.id ? updatedCategory : c));
  setState({ categories, currentCategory: updatedCategory });
}

async function handleReorderPhotos({ stepId, photoIds }) {
  const { currentCategory } = getState();
  if (!currentCategory) return;
  const step = currentCategory.steps.find((s) => s.id === stepId);
  if (!step) return;
  // Update positions based on new order
  const updatedPhotos = photoIds.map((id, index) => ({ id, position: index + 1 }));
  for (const { id, position } of updatedPhotos) {
    await storage.updatePhoto(id, { position });
  }
  // Update local state
  const photos = getState().photos.map((p) => {
    const updated = updatedPhotos.find((u) => u.id === p.id);
    return updated ? { ...p, position: updated.position } : p;
  });
  setState({ photos });
}

/* ------------------------------------------------------------------ Photo assignment */

function handleAssignPhotosToStep(step) {
  if (!step || !step.id) return;
  const { currentCategory } = getState();
  if (!currentCategory) {
    ui.showToast('Моля, първо изберете категория', { type: 'warn' });
    return;
  }
  showPhotoSelectionModal(currentCategory.id, step.id);
}

function showPhotoSelectionModal(categoryId, stepId) {
  const { photos } = getState();
  const { categories } = getState();
  const category = categories.find((c) => c.id === categoryId);
  const step = category?.steps?.find((s) => s.id === stepId);
  if (!category || !step) return;

  // Get ALL photos (not just category photos) with step info for badges
  const allPhotos = photos.map((p) => {
    let stepName = null;
    if (p.stepId) {
      const cat = categories.find((c) => c.id === p.categoryId);
      const stp = cat?.steps?.find((s) => s.id === p.stepId);
      stepName = stp?.name ?? null;
    }
    return { ...p, stepName };
  });

  const selectedIds = [...(step.photoIds ?? [])];

  ui.showPhotoSelectionModal({
    photos: allPhotos,
    selectedIds,
    stepName: step.name,
    stepId: step.id,
    categoryName: category.name,
    onPreview: (photo) => ui.openImagePreview(photo),  // Double-click to open full-size preview
    onConfirm: async (ids) => {
      // Update step's photoIds
      const steps = category.steps.map((s) => s.id === stepId ? { ...s, photoIds: ids } : s);
      const updatedCategory = { ...category, steps };
      await storage.saveCategory(updatedCategory);

      // Update photo records with stepId and position (auto next free)
      const assignedPhotos = allPhotos.filter(p => ids.includes(p.id));
      const maxPosition = assignedPhotos.length > 0
        ? Math.max(...assignedPhotos.filter(p => p.stepId === stepId).map(p => p.position || 0), 0)
        : 0;

      for (const photo of allPhotos) {
        const assigned = ids.includes(photo.id);
        if (assigned && photo.stepId !== stepId) {
          // New assignment - use next free position
          const newPosition = maxPosition + ids.indexOf(photo.id) + 1;
          await storage.updatePhoto(photo.id, { categoryId, stepId, position: newPosition });
        } else if (!assigned && photo.stepId === stepId) {
          // Removed from this step
          await storage.updatePhoto(photo.id, { stepId: null, position: null });
        }
        // If assigned and already in this step, keep existing position
      }

      const categories = getState().categories.map((c) => (c.id === categoryId ? updatedCategory : c));

      // Also update photos in state with new stepId and position
      const updatedPhotos = getState().photos.map((p) => {
        const assigned = ids.includes(p.id);
        if (assigned && p.stepId !== stepId) {
          const newPosition = maxPosition + ids.indexOf(p.id) + 1;
          return { ...p, categoryId, stepId, position: newPosition };
        } else if (!assigned && p.stepId === stepId) {
          return { ...p, stepId: null, position: null };
        }
        return p;
      });

      // Force refresh of thumbnails to ensure they're visible in step view
      await refreshGallery();

      // State is already updated by refreshGallery, just update categories
      setState({ categories, currentCategory: updatedCategory });
      ui.showToast(`Присвоени ${ids.length} снимки към "${step.name}"`, { type: 'success' });
    },
  });
}

/* ------------------------------------------------------------------ Watermark processing */

async function handleProcessSelected() {
  const { selectedPhotoIds, watermarkSettings, categories } = getState();
  if (selectedPhotoIds.length === 0) return;

  // Get selected photos and sort by category -> step order -> position
  // to ensure global sequential numbering matches visual badge order
  let photos = getState().photos.filter((p) => selectedPhotoIds.includes(p.id));

  // Build a map of step order for sorting
  const stepOrderMap = new Map();
  for (const cat of categories) {
    for (const step of cat.steps || []) {
      stepOrderMap.set(step.id, step.order ?? 999);
    }
  }

  // Sort: category -> step order -> position
  photos.sort((a, b) => {
    // First by category (to group by category)
    if (a.categoryId !== b.categoryId) {
      const catA = categories.find(c => c.id === a.categoryId);
      const catB = categories.find(c => c.id === b.categoryId);
      const orderA = catA?.order ?? 999;
      const orderB = catB?.order ?? 999;
      if (orderA !== orderB) return orderA - orderB;
    }
    // Then by step order within category
    const stepOrderA = stepOrderMap.get(a.stepId) ?? 999;
    const stepOrderB = stepOrderMap.get(b.stepId) ?? 999;
    if (stepOrderA !== stepOrderB) return stepOrderA - stepOrderB;
    // Finally by position within step
    return (a.position || 0) - (b.position || 0);
  });

  setState({ isProcessing: true });
  ui.showProcessModal();
  const results = { success: 0, errors: 0 };
  const processedBlobs = {};
  let globalNumber = 1;

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    ui.updateProcessProgress({
      current: i + 1,
      total: photos.length,
      status: 'Обработка...',
      currentFile: `#${globalNumber} ${photo.filename}`
    });
    try {
      let category = null;
      let step = null;
      if (photo.categoryId) {
        category = categories.find((c) => c.id === photo.categoryId);
        if (category && photo.stepId) {
          step = category.steps.find((s) => s.id === photo.stepId);
        }
      }
      const exifData = await exif.readExifData(photo.file);
      const gps = exifData?.gps ?? null;
      const dateTime = exifData?.dateTime ?? null;
      let weather = null;
      if (gps && watermarkSettings.showWeather) {
        weather = await fetchWeather(gps.latitude, gps.longitude).catch(() => null);
      }
      let address = null;
      if (gps && watermarkSettings.showAddress) {
        address = await geocode.reverseGeocode(gps.latitude, gps.longitude).catch(() => null);
      }
      let qrMatrix = null;
      if (watermarkSettings.showQrCode && gps) {
        const qrPayload = qr.qrPayloadForWatermark({
          latitude: gps.latitude,
          longitude: gps.longitude,
          altitude: gps.altitude,
          capturedAt: dateTime,
          address,
          temperature: weather?.temperature,
          humidity: weather?.humidity,
          photoNumber: globalNumber,
          totalPhotos: photos.length,
          category: category?.name,
          step: step?.name,
          description: step?.description,
        });
        qrMatrix = await qr.createQrMatrix(qrPayload);
      }
      let processedBlob;
      if (watermarkSettings.watermarkMode === 'numberOnly') {
        processedBlob = await watermark.withWatermark(photo.file, {
          ...watermarkSettings,
          photoNumber: globalNumber,
          totalPhotos: photos.length,
          category: category?.name,
          step: step?.name,
          showCoordinates: false,
          showAltitude: false,
          showDateTime: false,
          showAddress: false,
          showWeather: false,
          showQrCode: false,
          showCategoryStep: false,
          showDescription: false,
          numberPosition: watermarkSettings.numberPosition,
        });
      } else {
        processedBlob = await watermark.withWatermark(photo.file, {
          ...watermarkSettings,
          fix: gps,
          address,
          capturedAt: dateTime,
          weather,
          qrMatrix,
          photoNumber: globalNumber,
          totalPhotos: photos.length,
          category: category?.name,
          step: step?.name,
          numberPosition: watermarkSettings.numberPosition,
        });
      }

      const baseName = makePhotoFilename(new Date(), null, null, 'jpg').replace('.jpg', '');
      const filename = `${baseName}_#${globalNumber}.jpg`;
      processedBlobs[photo.id] = { blob: processedBlob.blob, filename };

      results.success++;
      globalNumber++;
      ui.addProcessResult(photo, true);
    } catch (error) {
      console.error('Processing error:', error);
      ui.addProcessResult(photo, false, error.message);
      results.errors++;
    }
  }

  setState({ processedBlobs });
  ui.updateProcessProgress({ current: photos.length, total: photos.length, status: 'Завършено' });
  ui.finishProcessing(results);
  ui.showToast(`Обработка завършена: ${results.success} успешни, ${results.errors} грешки`, { type: 'success' });
  setState({ isProcessing: false });
}

async function handleDownloadAll() {
  const { processedBlobs } = getState();
  if (!processedBlobs) return;
  const files = Object.values(processedBlobs);
  await ui.downloadAsZip(files, 'watermark-' + Date.now() + '.zip');
  ui.showToast('Архивът се изтегля...', { type: 'success' });
}

/* ------------------------------------------------------------------ Quick Watermark */

/**
 * Coerce a form value to a finite number, otherwise null.
 *
 * Note: `Number(null) === 0`, so null/undefined/empty must be rejected
 * explicitly - otherwise every untouched field would become 0.
 */
function finiteOrNull(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Shared tail of both quick-marking modes. */
function finishQuickProcessing(results, processedBlobs, total) {
  setState({ processedBlobs });
  ui.updateProcessProgress({ current: total, total, status: 'Завършено' });
  ui.finishProcessing(results);
  ui.showToast(`Обработка: ${results.success} успешни, ${results.errors} грешки`, { type: 'success' });
  setState({ isProcessing: false });
}

/** Corner badge only - the original quick-marking behaviour. */
async function applyNumberBadge(photoIds, position, { numberingMode = 'sequential', groupValue = '' } = {}) {
  const { photos, watermarkSettings } = getState();
  setState({ isProcessing: true });
  ui.showProcessModal();

  const results = { success: 0, errors: 0 };
  const processedBlobs = {};
  const selectedPhotos = photoIds.map((id) => photos.find((p) => p.id === id)).filter(Boolean);

  for (let i = 0; i < selectedPhotos.length; i++) {
    const photo = selectedPhotos[i];

    let photoNumber;
    switch (numberingMode) {
      case 'group':
        photoNumber = groupValue || 1;
        break;
      default:
        photoNumber = i + 1;
    }

    ui.updateProcessProgress({
      current: i + 1,
      total: selectedPhotos.length,
      status: 'Маркиране...',
      currentFile: `#${photoNumber} ${photo.filename}`,
    });

    try {
      const processedBlob = await watermark.withWatermark(photo.file, {
        ...watermarkSettings,
        // Override to number-only mode
        watermarkMode: 'numberOnly',
        numberPosition: position,
        numberFormat: 'number', // Just the number: "1", "2", "3"
        showCoordinates: false,
        showAltitude: false,
        showDateTime: false,
        showAddress: false,
        showWeather: false,
        showQrCode: false,
        showCategoryStep: false,
        showDescription: false,
        photoNumber,
        totalPhotos: selectedPhotos.length,
      });

      const baseName = makePhotoFilename(new Date(), null, null, 'jpg').replace('.jpg', '');
      const filename = `${baseName}_#${photoNumber}.jpg`;
      processedBlobs[photo.id] = { blob: processedBlob.blob, filename };

      results.success++;
      ui.addProcessResult(photo, true);
    } catch (error) {
      console.error('Quick watermark error:', error);
      ui.addProcessResult(photo, false, error.message);
      results.errors++;
    }
  }

  finishQuickProcessing(results, processedBlobs, selectedPhotos.length);
}

/**
 * Classic "Image Coordinate" panel: one shared dataset plus a per-photo hour.
 * The panel wording/order comes from `look: 'classic'` in watermark.js.
 *
 * `badge` is optional; when present the number is drawn as a separate mark in
 * the top-left corner (the only place it may occupy next to a watermark).
 */
async function applyClassicPanel(photoIds, { shared = {}, times = {}, badge = null } = {}) {
  const { photos, watermarkSettings } = getState();
  setState({ isProcessing: true });
  ui.showProcessModal();

  const results = { success: 0, errors: 0 };
  const processedBlobs = {};
  const usedNames = new Set();
  const selectedPhotos = photoIds.map((id) => photos.find((p) => p.id === id)).filter(Boolean);

  for (let i = 0; i < selectedPhotos.length; i++) {
    const photo = selectedPhotos[i];

    const time = times[photo.id] || '12:00';
    const capturedAt = shared.date ? new Date(`${shared.date}T${time}`) : new Date();

    // Partial coordinates are allowed: only what was typed ends up on the photo.
    const latitude = finiteOrNull(shared.latitude);
    const longitude = finiteOrNull(shared.longitude);
    const fix =
      latitude !== null || longitude !== null
        ? { latitude, longitude, accuracy: finiteOrNull(shared.accuracy), altitude: finiteOrNull(shared.altitude) }
        : null;

    const temperature = finiteOrNull(shared.temperature);
    const humidity = finiteOrNull(shared.humidity);
    const weather = temperature !== null && humidity !== null ? { temperature, humidity } : null;

    // Separate number mark ("watermark + number" mode): sequential or group value.
    let badgeText = null;
    if (badge) {
      badgeText = badge.numberingMode === 'group' ? badge.groupValue || '1' : String(i + 1);
    }

    ui.updateProcessProgress({
      current: i + 1,
      total: selectedPhotos.length,
      status: 'Воден знак...',
      currentFile: `${capturedAt.toLocaleTimeString('bg-BG')} ${photo.filename}`,
    });

    try {
      let qrMatrix = null;
      // The navigation QR needs a full coordinate pair; a single value is skipped.
      if (shared.qr && fix && Number.isFinite(fix.latitude) && Number.isFinite(fix.longitude)) {
        qrMatrix = await qr.createQrMatrix(qr.qrPayloadFor(fix.latitude, fix.longitude));
      }

      const processed = await watermark.withWatermark(photo.file, {
        look: 'classic',
        fix,
        address: shared.address,
        capturedAt,
        weather,
        brand: shared.brand || '',
        qrMatrix,
        showQrCode: Boolean(shared.qr && qrMatrix),
        cornerBadge: badgeText
          ? { text: badgeText, suffix: badge.suffix || '', position: 'top-left' }
          : null,
        maxEdge: watermarkSettings.maxEdge ?? 4096,
        quality: watermarkSettings.quality ?? 0.92,
      });

      const baseName = makePhotoFilename(
        capturedAt,
        fix?.latitude ?? null,
        fix?.longitude ?? null,
        'jpg',
      ).replace(/\.jpg$/, '') + (badgeText ? `_#${badgeText}` : '');
      let filename = `${baseName}.jpg`;
      let counter = 1;
      while (usedNames.has(filename.toLowerCase())) {
        filename = `${baseName}_${++counter}.jpg`;
      }
      usedNames.add(filename.toLowerCase());

      processedBlobs[photo.id] = { blob: processed.blob, filename };

      results.success++;
      ui.addProcessResult(photo, true);
    } catch (error) {
      console.error('Classic watermark error:', error);
      ui.addProcessResult(photo, false, error.message);
      results.errors++;
    }
  }

  finishQuickProcessing(results, processedBlobs, selectedPhotos.length);
}

function handleQuickWatermark() {
  const { photos, selectedPhotoIds, watermarkSettings } = getState();
  if (selectedPhotoIds.length === 0) return;

  const currentPosition = watermarkSettings.numberPosition || 'bottom-right';

  ui.showQuickWatermarkModal({
    photos,
    selectedIds: selectedPhotoIds,
    currentPosition,
    onApply: async (photoIds, position, options = {}) => {
      console.log('🔵 [Quick Watermark] Apply clicked:', { photoIds, position, count: photoIds.length, options });
      if (options.kind === 'number') {
        await applyNumberBadge(photoIds, position, options);
      } else {
        // 'classic' (panel only) and 'both' (panel + separate top-left number)
        await applyClassicPanel(photoIds, options);
      }
    },
    onCancel: () => {
      console.log('🔵 [Quick Watermark] Cancelled');
    }
  });
}

function handleSaveWatermarkSettings() {
  const form = refs['watermark-settings-form'];
  if (!form) return;
  const formData = new FormData(form);
  const settings = {};
  for (const [key, value] of formData.entries()) {
    const num = Number(value);
    settings[key] = Number.isNaN(num) ? (value === 'true' ? true : value === 'false' ? false : value) : num;
  }
  // Add watermark mode settings from selector
  const modeRadio = document.querySelector('input[name="watermark-mode"]:checked');
  const posRadio = document.querySelector('input[name="number-position"]:checked');
  if (modeRadio) settings.watermarkMode = modeRadio.value;
  if (posRadio) settings.numberPosition = posRadio.value;

  storage.setSetting('watermarkSettings', settings);
  setState({ watermarkSettings: { ...DEFAULT_WATERMARK_SETTINGS, ...settings } });
  ui.showToast('Настройките са запазени', { type: 'success' });
}

/* ------------------------------------------------------------------ Navigation */

function handleNavClick(view) {
  ui.switchView(view);
  setState({ currentView: view });
  if (view === 'category') {
    const { categories } = getState();
    ui.renderCategories(categories, {
      onSelect: handleCategorySelect,
      onEdit: handleEditCategory,
      onDelete: handleDeleteCategory,
      onReorder: handleReorderCategories,
    });
  } else if (view === 'gallery') {
    refreshGallery();
  } else if (view === 'settings') {
    ui.loadWatermarkSettings(getState().watermarkSettings);
  }
}

// Helper to safely add click listener (clones element to remove old listeners)
function addClickListener(element, handler) {
  if (!element) return;
  element.replaceWith(element.cloneNode(true));
  clearRef(element.id);
  const newEl = document.getElementById(element.id);
  newEl?.addEventListener('click', handler);
}

function wireEvents() {
  console.log('🔵 [wireEvents] Attaching event listeners...');
  console.log('🔵 [wireEvents] refs.btn-load-photos:', refs['btn-load-photos']);
  console.log('🔵 [wireEvents] refs.nav-main:', refs['nav-main']);
  console.log('🔵 [wireEvents] refs.nav-gallery:', refs['nav-gallery']);
  console.log('🔵 [wireEvents] refs.nav-categories:', refs['nav-categories']);
  console.log('🔵 [wireEvents] refs.nav-settings:', refs['nav-settings']);
  
  addClickListener(refs['nav-main'], () => { console.log('🟢 [nav] main clicked'); handleNavClick('main'); });
  addClickListener(refs['nav-gallery'], () => { console.log('🟢 [nav] gallery clicked'); handleNavClick('gallery'); });
  addClickListener(refs['nav-categories'], () => { console.log('🟢 [nav] category clicked'); handleNavClick('category'); });
  addClickListener(refs['nav-settings'], () => { console.log('🟢 [nav] settings clicked'); handleNavClick('settings'); });
  addClickListener(refs['nav-help'], () => { console.log('🟢 [nav] help clicked'); handleNavClick('help'); });
  // Main page quick action buttons
  addClickListener(refs['nav-gallery-quick'], () => { console.log('🟢 [nav] gallery quick clicked'); handleNavClick('gallery'); });
  addClickListener(refs['nav-categories-quick'], () => { console.log('🟢 [nav] categories quick clicked'); handleNavClick('category'); });
  addClickListener(refs['btn-load-photos'], () => { console.log('🟢 [btn] Load Photos clicked'); handleLoadPhotos(); });
  addClickListener(refs['btn-load-photos-gallery'], () => { console.log('🟢 [btn] Load Photos (Gallery) clicked'); handleLoadPhotos(); });
  addClickListener(refs['btn-process-selected'], () => { console.log('🟢 [btn] Process Selected clicked'); handleQuickWatermark(); });
  addClickListener(refs['btn-select-all'], () => { console.log('🟢 [btn] Select All clicked'); handleSelectAllPhotos(); });
  addClickListener(refs['btn-deselect-all'], () => { console.log('🟢 [btn] Deselect All clicked'); handleDeselectAllPhotos(); });
  addClickListener(refs['btn-delete-all-photos'], () => { console.log('🟢 [btn] Delete All Photos clicked'); handleDeleteAllPhotos(); });
  addClickListener(refs['btn-add-category'], () => { console.log('🟢 [btn] Add Category clicked'); handleAddCategory(); });
  addClickListener(refs['btn-export-categories'], () => { console.log('🟢 [btn] Export Categories clicked'); handleExportCategories(); });
  addClickListener(refs['btn-import-categories'], () => { console.log('🟢 [btn] Import Categories clicked'); handleImportCategories(); });
  addClickListener(refs['btn-process-category-step'], () => { console.log('🟢 [btn] Process Category from Step clicked'); handleProcessCategoryFromStep(); });
  addClickListener(refs['btn-add-step'], () => { console.log('🟢 [btn] Add Step clicked'); handleAddStep(); });
  addClickListener(refs['btn-delete-step'], () => { console.log('🟢 [btn] Delete Step clicked'); handleDeleteStep(); });
  addClickListener(refs['btn-back-category'], () => { console.log('🟢 [btn] Back to Category clicked'); handleNavClick('category'); });
  addClickListener(refs['btn-download-all'], () => { console.log('🟢 [btn] Download All clicked'); handleDownloadAll(); });
  addClickListener(refs['btn-close-process'], () => {
    console.log('🟢 [btn] Close Process clicked');
    ui.hideProcessModal();
    setState({ isProcessing: false, processedBlobs: null });
  });
  addClickListener(refs['btn-save-watermark-settings'], () => { console.log('🟢 [btn] Save Settings clicked'); handleSaveWatermarkSettings(); });

  // Attach close handlers to all modal close buttons (X in top-right)
  document.querySelectorAll('.modal__close').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = btn.closest('.modal');
      if (modal) {
        modal.hidden = true;
        // Special handling for process modal
        if (modal.id === 'process-modal') {
          ui.hideProcessModal();
          setState({ isProcessing: false, processedBlobs: null });
        }
      }
    });
  });

  // Watermark mode selector event listeners
  const modeRadios = document.querySelectorAll('input[name="watermark-mode"]');
  modeRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      const settings = getState().watermarkSettings;
      settings.watermarkMode = e.target.value;
      setState({ watermarkSettings: settings });
      // Show/hide number position options
      const numberPositionOptions = document.getElementById('number-position-options');
      const numberOnlyRadio = document.getElementById('watermark-mode-numberOnly');
      if (numberPositionOptions && numberOnlyRadio) {
        numberPositionOptions.hidden = !numberOnlyRadio.checked;
      }
      ui.showToast(`Режим: ${e.target.value === 'full' ? 'Пълен воден знак' : 'Само номер'}`, { type: 'info' });
    });
  });

  const positionRadios = document.querySelectorAll('input[name="number-position"]');
  positionRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      const settings = getState().watermarkSettings;
      settings.numberPosition = e.target.value;
      setState({ watermarkSettings: settings });
      ui.showToast(`Позиция на номера: ${e.target.value}`, { type: 'info' });
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      console.log('🟢 [key] Escape pressed');
      for (const modalId of ['category-modal', 'step-modal', 'photo-selection-modal', 'process-modal', 'quick-watermark-modal']) {
        const modal = refs[modalId];
        if (modal && !modal.hidden) {
          modal.hidden = true;
          // Special handling for process modal
          if (modalId === 'process-modal') {
            setState({ isProcessing: false, processedBlobs: null });
          }
        }
      }
    }
  });
  console.log('🔵 [wireEvents] All event listeners attached');
}

/* ------------------------------------------------------------------ Bootstrap */

export async function initializeApp() {
  console.log(`🚀 Watermark Creation v${APP_VERSION} - Starting...`);
  try {
    refs = ui.createRefs();
    // Initialize image preview modal
    ui.initImagePreview();
    initState();
    await loadSavedData();
    wireEvents();
    subscribe(renderAll);
    renderAll();
    const bootRoot = ui.ref('boot-root');
    const appRoot = ui.ref('app-root');
    if (bootRoot) bootRoot.hidden = true;
    if (appRoot) appRoot.hidden = false;
  } catch (error) {
    console.error('App initialization failed:', error);
    const bootRoot = ui.ref('boot-root');
    if (bootRoot) {
      bootRoot.innerHTML = '<div style=\"color:#ff6b6b;text-align:center;padding:2rem;\"><h2>Грешка при стартиране</h2><p>' + error.message + '</p><button onclick=\"location.reload()\" class=\"btn btn--primary\">Опитай отново</button></div>';
    }
  }
}

function renderAll() {
  const state = getState();
  // Update dashboard stats on every render
  ui.updateDashboardStats({ photos: state.photos, categories: state.categories });
  
  if (state.currentView === 'gallery') {
    ui.renderGallery(state.photos, {
      selectedPhotoIds: state.selectedPhotoIds,
      onSelect: handlePhotoSelect,
      onClick: handlePhotoClick,
      onAssign: handlePhotoAssign,
      onDelete: handleDeletePhoto,
      onPreview: (photo) => ui.openImagePreview(photo),  // Double-click to open full-size preview
      categories: state.categories,
    });
    updateSelectedCount();
  }
  if (state.currentView === 'category') {
    ui.renderCategories(state.categories, { onSelect: handleCategorySelect, onEdit: handleEditCategory, onDelete: handleDeleteCategory, onReorder: handleReorderCategories });
  }
  if (state.currentView === 'step' && state.currentCategory) {
    ui.renderSteps(state.currentCategory, {
      onSelect: handleStepSelect,
      onEdit: handleEditStep,
      onDelete: handleDeleteStep,
      onReorder: handleReorderSteps,
      onAssignPhotos: handleAssignPhotosToStep,
      photos: state.photos,
      onReorderPhotos: handleReorderPhotos,
      onPreview: (photo) => ui.openImagePreview(photo),  // Double-click to open full-size preview
    });
  }
  const processBtn = refs['btn-process-selected'];
  if (processBtn) {
    processBtn.disabled = state.selectedPhotoIds.length === 0 || state.isProcessing;
  }
}