const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const oldText = `setState({ categories, currentCategory: updatedCategory, photos: updatedPhotos });
      ui.showToast(\`Присвоени \${ids.length} снимки към "\${step.name}"\`, { type: 'success' });`;

const newText = `// Force refresh of thumbnails to ensure they're visible in step view
      await refreshGallery();

      // State is already updated by refreshGallery, just update categories
      setState({ categories, currentCategory: updatedCategory });
      ui.showToast(\`Присвоени \${ids.length} снимки към "\${step.name}"\`, { type: 'success' });`;

if (content.includes(oldText)) {
  content = content.replace(oldText, newText);
  fs.writeFileSync('src/main.js', content);
  console.log('Replaced successfully');
} else {
  console.log('Old text not found');
  // Debug: find the exact content
  const idx = content.indexOf('setState({ categories, currentCategory: updatedCategory, photos: updatedPhotos })');
  if (idx >= 0) {
    console.log('Found at index:', idx);
    console.log('Context:', JSON.stringify(content.substring(idx, idx + 200)));
  }
}