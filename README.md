# Watermark Creation

**Приложение за добавяне на водни знакове на снимки с GPS, метео, QR код и стъпки**

Watermark Creation е уеб приложение (PWA), работещо напълно локално в браузъра, което позволява добавяне на водни знакове върху снимки. Изработено е за ползване на мобилни устройства и десктоп, без нужда от интернет връзка след първоначалното зареждане.

## ✨ Функционалности

### Работи веднага (v1.0.0)
- **🔢 Бърза маркировка с номер** — избор на снимки, позиция на номера (↖ ↗ ↙ ↘), еднокликовно прилагане
- **📁 Категории и стъпки** — създаване на йерархична структура: Категория → Стъпки → Снимки
- **🖱️ Drag & Drop подреждане** — промяна на реда на категории, стъпки и снимки чрез дъргане
- **💾 Локално запазване** — всичко се пази в IndexedDB (браузър), работи офлайн
- **📊 Статистики** — брой снимки, категории, стъпки, присвоени снимки на таблото
- **📱 PWA поддръжка** — инсталира се като приложение на телефона/десктопа

### В разработка (будущи версии)
- 📍 GPS координати и височина
- 🏠 Адрес от координати (reverse geocoding)
- 🕐 Дата и час на заснемане (EXIF)
- 🌤️ Времеви условия (температура, влажност)
- 📱 QR код с пълна информация
- 📝 Текстово описание на стъпката
- 🤖 **AI обработка на снимки** — автоматично разпознаване на обекти/ситуации, четене на съществуващи водни знаци, извличане на мета-информация (EXIF, GPS, дата/час), помощ за хронологично подреждане

## 🚀 Бърз старт

### Предварителни изисквания
- Node.js 18+ 
- npm 9+

### Инсталация
```bash
# Клониране
git clone https://github.com/your-username/watermark-creation.git
cd watermark-creation

# Инсталиране на зависимости
npm install

# Development сървър
npm run dev

# Production build
npm run build

# Preview на production build
npm run preview
```

## 📖 Как да работите

### 1. Заредете снимки
Натиснете **"Зареди снимки"** → изберете файлове → снимките се показват в **Галерията**

### 2. Създайте категория
**Категории** → **"Добави категория"** → име, описание, ред → **"Запази"**

### 3. Добавете стъпки
Кликнете на категория → **"Добави стъпка"** → име, описание, необходим брой снимки, ред → **"Запази"**

### 4. Присвоете снимки
В категорията → **"Присвои снимки"** до стъпката → отметнете снимки → **"Потвърди избор"**  
Редът се променя с **drag & drop** (⋮⋮ иконата)

### 5. Бърза маркировка
В **Галерията** отметнете снимки → **"Обработи избраните"** → изберете позиция (↖ ↗ ↙ ↘) → **"Приложи"**

### 5. Изтеглете резултати
След обработка → **"Изтегли всички"** → файлове като `IMG_20241116_143022_#1.jpg`

## 🛠️ Технологии

| Технология | Назначение |
|------------|------------|
| **Vanilla JS (ES Modules)** | Core логика, без фреймворкове |
| **Vite** | Build tool & dev server |
| **IndexedDB** | Локално съхранение (файлове, метаданни) |
| **Canvas API** | Рендеринг на водни знакове върху снимки |
| **QRCode Generator** | Генериране на QR кодове |
| **Service Worker / Workbox** | PWA, офлайн работа |
| **CSS Custom Properties** | Темна/светла тема, responsive дизайн |

## 📁 Структура на проекта

```
watermark-creation/
├── index.html              # Основен HTML
├── package.json
├── vite.config.js
├── .gitignore
├── public/                 # Статични файлове (икони, manifest)
│   ├── icon.svg
│   └── manifest.webmanifest
├── src/
│   ├── boot.js             # Entry point
│   ├── main.js             # Оркестрация, state, events
│   ├── state.js            # Реактивен state management
│   ├── styles/
│   │   └── main.css        # Всички стилове
│   ├── modules/
│   │   ├── ui.js           # DOM, rendering, modals
│   │   ├── watermark.js    # Canvas watermark rendering
│   │   ├── qr.js           # QR код генерация
│   │   ├── exif.js         # EXIF/GPS четене
│   │   ├── geocode.js      # Reverse geocoding
│   │   ├── storage.js      # IndexedDB wrapper
│   │   └── archive.js      # JSON архивиране
│   └── utils/
│       ├── image.js        # Canvas/thumbnail helpers
│       ├── coords.js       # GPS форматиране
│       └── weather.js      # Weather API
└── dist/                   # Production build (auto-generated)
```

## 🔧 Конфигурация

### Environment променливи (`.env`)
```env
# Опционално - за weather API (ако се използва външен provider)
VITE_WEATHER_API_KEY=your_key_here
```

### PWA конфигурация (`vite.config.js`)
```js
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Watermark Creation',
        short_name: 'Watermark',
        theme_color: '#0b1220',
        background_color: '#0b1220',
        display: 'standalone',
      }
    })
  ]
})
```

## 📦 Deployment

### GitHub Pages
```bash
npm run build
# Качете съдържанието на dist/ в gh-pages branch
```

### Netlify / Vercel / Firebase Hosting
```bash
# Build command: npm run build
# Output directory: dist
# Install command: npm install
```

### Docker (опционално)
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

## 🤝 Принос

1. Forkнете репозиторито
2. Създайте feature branch (`git checkout -b feature/amazing-feature`)
3. Commitнете промените (`git commit -m 'Add amazing feature'`)
4. Pushнете към branch (`git push origin feature/amazing-feature`)
5. Отворете Pull Request

## 📄 Лиценз

Този проект е под MIT лиценз. Вижте `LICENSE` файла за подробности.

## 👨‍💻 Автор

**RedFox**  
📧 deyan.shahov@infralink-de.com

## 📋 Версии

| Версия | Дата | Промени |
|--------|------|---------|
| 1.0.0 | 2024-11-16 | Първоначално издание - бърза маркировка, категории/стъпки, PWA |

## 🙏 Благодарности

- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) за QR кодове
- [Vite](https://vitejs.dev/) за бързия build
- [Workbox](https://developers.google.com/workbox) за PWA поддръжка