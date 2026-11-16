const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

// Find and replace the problematic section
const oldText = `const categories = getState().categories.map((c) => (c.id === categoryId ? updatedCategory : c));
      setState({ categories, currentCategory: updatedCategory });
      ui.showToast(\`Присвоени \${ids.length} снимки към "\${step.name}"\`, { type: 'success' });
    },
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

      setState({ categories, currentCategory: updatedCategory, photos: updatedPhotos });
  });
}`;

const newText = `const categories = getState().categories.map((c) => (c.id === categoryId ? updatedCategory : c));

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

      setState({ categories, currentCategory: updatedCategory, photos: updatedPhotos });
      ui.showToast(\`Присвоени \${ids.length} снимки към "\${step.name}"\`, { type: 'success' });
    },
  });
}`;

if (content.includes(oldText)) {
  content = content.replace(oldText, newText);
  fs.writeFileSync('src/main.js', content);
  console.log('Replaced successfully');
} else {
  console.log('Old text not found');
}