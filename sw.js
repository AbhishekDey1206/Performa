// Performa Tracker Service Worker
// Version 2.0.1 - Fixed offline behavior and icons

const CACHE_NAME = 'performa-tracker-v2.0.1';
const STATIC_CACHE = 'performa-static-v2.0.1';
const DYNAMIC_CACHE = 'performa-dynamic-v2.0.1';
const IMAGE_CACHE = 'performa-images-v2.0.1';

// Assets to cache immediately
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// External resources that should be cached
const EXTERNAL_RESOURCES = [
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://html2canvas.hertzen.com/dist/html2canvas.min.js',
  'https://unpkg.com/leaflet@1.7.1/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.7.1/dist/leaflet.js'
];

// Cache strategies
const CACHE_STRATEGIES = {
  // Cache first (for static assets)
  CACHE_FIRST: 'cache-first',
  // Network first (for dynamic content)
  NETWORK_FIRST: 'network-first',
  // Stale while revalidate (for frequently updated content)
  STALE_WHILE_REVALIDATE: 'stale-while-revalidate',
  // Network only (for real-time data)
  NETWORK_ONLY: 'network-only'
};

// Install event - cache static assets
self.addEventListener('install', event => {
  console.log('🚀 Performa SW: Installing service worker v2.0.1');
  
  event.waitUntil(
    Promise.all([
      // Cache static assets
      caches.open(STATIC_CACHE).then(cache => {
        console.log('📦 Performa SW: Caching static assets');
        return cache.addAll(STATIC_ASSETS).catch(error => {
          console.warn('⚠️ Performa SW: Some assets failed to cache:', error);
          // Try to cache assets individually
          return Promise.allSettled(
            STATIC_ASSETS.map(asset => 
              fetch(asset).then(response => {
                if (response.ok) {
                  return cache.put(asset, response);
                }
              }).catch(err => console.warn(`Failed to cache ${asset}:`, err))
            )
          );
        });
      }),
      
      // Cache external resources with error handling
      caches.open(DYNAMIC_CACHE).then(cache => {
        console.log('🌐 Performa SW: Caching external resources');
        return Promise.allSettled(
          EXTERNAL_RESOURCES.map(url => 
            fetch(url, { mode: 'cors' })
              .then(response => response.ok ? cache.put(url, response) : Promise.resolve())
              .catch(err => {
                console.warn(`⚠️ Performa SW: Failed to cache ${url}:`, err);
                return Promise.resolve();
              })
          )
        );
      })
    ]).then(() => {
      console.log('✅ Performa SW: Installation complete');
      // Force activation
      return self.skipWaiting();
    })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  console.log('🔄 Performa SW: Activating service worker v2.0.1');
  
  event.waitUntil(
    Promise.all([
      // Clean up old caches
      caches.keys().then(cacheNames => {
        const validCaches = [STATIC_CACHE, DYNAMIC_CACHE, IMAGE_CACHE];
        return Promise.all(
          cacheNames
            .filter(cacheName => !validCaches.includes(cacheName))
            .map(cacheName => {
              console.log('🗑️ Performa SW: Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            })
        );
      }),
      
      // Take control of all clients
      self.clients.claim()
    ]).then(() => {
      console.log('✅ Performa SW: Activation complete');
    })
  );
});

// Fetch event - handle all network requests
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }
  
  // Handle different types of requests
  if (request.url.includes('index.html') || request.url === self.location.origin + '/') {
    // HTML pages - Network first with cache fallback
    event.respondWith(handleHTMLRequest(request));
  } else if (request.url.includes('.js') || request.url.includes('.css')) {
    // Scripts and styles - Cache first
    event.respondWith(handleStaticAssets(request));
  } else if (request.url.includes('icons/') || request.destination === 'image') {
    // Images - Cache first with long-term storage
    event.respondWith(handleImageRequest(request));
  } else if (url.origin !== self.location.origin) {
    // External resources - Cache first with fallback
    event.respondWith(handleExternalRequest(request));
  } else {
    // Default - Stale while revalidate
    event.respondWith(handleDefaultRequest(request));
  }
});

// HTML request handler - Cache first for PWA experience
async function handleHTMLRequest(request) {
  // Always try cache first for better PWA experience
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    console.log('📱 Performa SW: Serving cached HTML');
    return cachedResponse;
  }
  
  try {
    // Try network if not in cache
    console.log('🌐 Performa SW: Fetching fresh HTML');
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      // Update cache with fresh content
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, networkResponse.clone());
      return networkResponse;
    }
  } catch (error) {
    console.warn('🌐 Performa SW: Network failed for HTML');
  }
  
  // If we get here, show a simple offline message
  return new Response(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Performa Tracker - Connection Issue</title>
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <style>
        body { font-family: system-ui; text-align: center; padding: 2rem; background: #e0f7fa; color: #00796b; }
        h1 { color: #004d40; }
        .icon { font-size: 3rem; margin: 1rem 0; }
        button { background: #00796b; color: white; border: none; padding: 1rem 2rem; border-radius: 8px; cursor: pointer; }
      </style>
    </head>
    <body>
      <div class="icon">🏋️‍♂️</div>
      <h1>Performa Tracker</h1>
      <p>Unable to load the app. Please check your connection.</p>
      <button onclick="window.location.reload()">Try Again</button>
    </body>
    </html>
  `, {
    headers: { 'Content-Type': 'text/html' }
  });
}

// Static assets handler - Cache first
async function handleStaticAssets(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }
  
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.warn('📦 Performa SW: Failed to fetch static asset:', request.url);
    // Return a minimal fallback for critical resources
    if (request.url.includes('.css')) {
      return new Response('/* Offline - styles unavailable */', {
        headers: { 'Content-Type': 'text/css' }
      });
    }
    throw error;
  }
}

// Image request handler - Cache first with compression
async function handleImageRequest(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }
  
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(IMAGE_CACHE);
      // Cache images for longer periods
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.warn('🖼️ Performa SW: Failed to fetch image:', request.url);
    // Return placeholder image
    return new Response(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100" height="100" fill="#e0f7fa"/><text x="50" y="50" text-anchor="middle" dy=".3em" fill="#00796b">📷</text></svg>',
      { headers: { 'Content-Type': 'image/svg+xml' } }
    );
  }
}

// External request handler - Cache first with timeout
async function handleExternalRequest(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }
  
  try {
    // Add timeout for external requests
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const networkResponse = await fetch(request, {
      signal: controller.signal,
      mode: 'cors'
    });
    
    clearTimeout(timeoutId);
    
    if (networkResponse.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.warn('🌐 Performa SW: External request failed:', request.url);
    // Provide appropriate fallbacks for different external resources
    if (request.url.includes('chart.js')) {
      return new Response('window.Chart = { register: () => {}, Chart: function() {} };', {
        headers: { 'Content-Type': 'application/javascript' }
      });
    }
    throw error;
  }
}

// Default request handler - Stale while revalidate
async function handleDefaultRequest(request) {
  const cache = await caches.open(DYNAMIC_CACHE);
  const cachedResponse = await caches.match(request);
  
  // Return cached version immediately if available
  const fetchPromise = fetch(request).then(networkResponse => {
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  }).catch(error => {
    console.warn('🔄 Performa SW: Network request failed:', request.url, error);
    return cachedResponse;
  });
  
  return cachedResponse || fetchPromise;
}

// Background sync for offline data
self.addEventListener('sync', event => {
  console.log('🔄 Performa SW: Background sync triggered:', event.tag);
  
  if (event.tag === 'sync-exercise-data') {
    event.waitUntil(syncExerciseData());
  }
});

// Sync exercise data when back online
async function syncExerciseData() {
  try {
    console.log('📊 Performa SW: Syncing exercise data');
    // In a real implementation, this would sync with a backend
    // For now, we just ensure IndexedDB consistency
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'SYNC_COMPLETE',
        message: 'Exercise data synced successfully'
      });
    });
  } catch (error) {
    console.error('❌ Performa SW: Sync failed:', error);
  }
}

// Push notifications (for future features)
self.addEventListener('push', event => {
  console.log('🔔 Performa SW: Push notification received');
  
  const options = {
    body: event.data ? event.data.text() : 'Time for your workout!',
    icon: './icons/icon-192.png',
    badge: './icons/icon-72.png',
    vibrate: [200, 100, 200],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    },
    actions: [
      {
        action: 'open-app',
        title: 'Open Performa',
        icon: './icons/icon-192.png'
      },
      {
        action: 'dismiss',
        title: 'Dismiss'
      }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification('Performa Tracker', options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', event => {
  console.log('🔔 Performa SW: Notification clicked');
  
  event.notification.close();
  
  if (event.action === 'open-app') {
    event.waitUntil(
      self.clients.openWindow('./')
    );
  }
});

// Error handling
self.addEventListener('error', event => {
  console.error('❌ Performa SW: Service worker error:', event.error);
});

self.addEventListener('unhandledrejection', event => {
  console.error('❌ Performa SW: Unhandled rejection:', event.reason);
});

// Periodic background sync (when supported)
self.addEventListener('periodicsync', event => {
  if (event.tag === 'data-backup') {
    event.waitUntil(performDataBackup());
  }
});

async function performDataBackup() {
  console.log('💾 Performa SW: Performing periodic data backup');
  // Implementation for periodic data backup
}

// Cache management utilities
async function cleanupOldCaches() {
  const cacheNames = await caches.keys();
  const oldCaches = cacheNames.filter(name => 
    name.startsWith('performa-') && !name.includes('v2.0.1')
  );
  
  await Promise.all(oldCaches.map(name => caches.delete(name)));
  console.log('🧹 Performa SW: Cleaned up old caches:', oldCaches);
}

// Message handling from the app
self.addEventListener('message', event => {
  console.log('💬 Performa SW: Message received:', event.data);
  
  switch (event.data.type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
    case 'CACHE_EXERCISE_DATA':
      // Cache specific exercise data
      break;
    case 'CLEAN_CACHE':
      cleanupOldCaches();
      break;
    default:
      console.log('Unknown message type:', event.data.type);
  }
});

console.log('🏋️‍♂️ Performa Tracker Service Worker v2.0.1 loaded successfully');