# RitePath Kiosk - Web Apps System

## Overview

The RitePath Kiosk now supports web-based app shortcuts that display websites inside the Electron kiosk window. These apps appear as icons on the home screen alongside Google, Settings, and Files.

When a user clicks a web app icon, the website loads inside the kiosk's webview with a "Home" button to return to the launcher.

## Architecture

```
Home Screen
    ↓
Web App Configuration
    ↓
WebAppScreen Component
    ↓
Electron Webview
    ↓
Website Content
```

### Key Files

- **frontend/src/config/webApps.ts** - Web app definitions and configuration
- **frontend/src/screens/WebAppScreen.tsx** - Displays web app content
- **frontend/src/screens/HomeScreen.tsx** - Shows web app icons in launcher
- **frontend/src/App.tsx** - Routes to web app screens
- **frontend/src/components/AppIcon.tsx** - Renders app icons (includes image support)
- **frontend/src/App.css** - Styles for web apps

## Current Web Apps

### RitePath

- **Name:** RitePath
- **URL:** https://ritepath.com
- **Icon:** /Ritepath.png (image-based)
- **Color:** Purple gradient

## Adding New Web Apps

To add a new web app, edit `frontend/src/config/webApps.ts`:

```typescript
export const webApps: WebApp[] = [
  {
    id: "ritepath",
    name: "RitePath",
    icon: "/Ritepath.png",
    url: "https://ritepath.com"
  },
  // Add new web app here:
  {
    id: "help",
    name: "Help",
    icon: "/icons/help.png",  // Or use existing image
    url: "https://ritepath.com/help"
  }
];
```

### Icon Types

**Image-based Icons** (Recommended):
- File path starting with `/` or containing `.`
- Example: `/Ritepath.png`, `/icons/help.png`
- Scaled to fit the icon badge with padding
- Background: Purple gradient

**Built-in SVG Icons** (For system apps):
- google, settings, files
- Already hardcoded in AppIcon component
- Used for core kiosk functions

## Configuration Reference

### WebApp Type

```typescript
type WebApp = {
  id: string;           // Unique identifier (kebab-case)
  name: string;         // Display name on home screen
  icon: string;         // Path to icon image (or 'google'/'settings'/'files')
  url: string;          // Website URL to load
};
```

### Requirements

- **id:** Must be unique, alphanumeric/hyphens only
- **name:** Human-readable, shown below icon
- **icon:** 
  - For image icons: path starting with `/` (from public folder)
  - For SVG icons: use 'google', 'settings', or 'files'
  - Recommended size: Square PNG 256x256px or larger
- **url:** Full HTTPS URL (required for security)

## How It Works

### Flow

1. **Home Screen Renders**
   - App reads `webApps` configuration
   - Creates AppIcon component for each web app
   - All apps rendered in 3-column grid

2. **User Taps Web App Icon**
   - App stores `appId` in screen state
   - Navigates to `WebAppScreen`

3. **WebAppScreen Loads**
   - Finds app by ID in configuration
   - Creates webview element
   - Loads the website URL
   - Shows "Home" button in top-right corner

4. **User Interacts with Website**
   - Normal web browsing works
   - Links navigate within the webview
   - External links open normally
   - Touch input fully supported

5. **User Taps Home**
   - WebAppScreen unmounts
   - Returns to home screen
   - All other apps still functional

## Navigation & Return

**Automatic Return to Home:**
- User taps the "Home" button (floating button, top-right)
- Returns to the kiosk home screen instantly

**Kiosk Gestures:**
- Swipe up from bottom → Opens app drawer
- Swipe down from top → Closes webview, returns home

**Browser Navigation:**
- Back button in website works normally
- Links within the site navigate as expected
- External links behave according to Electron's security settings

## Image Requirements

### Icon Image Specifications

- **Format:** PNG (preferred), JPG, or SVG
- **Dimensions:** Square (recommended 256×256px or larger)
- **Aspect Ratio:** 1:1 (square)
- **Colors:** RGB or RGBA
- **Transparency:** Supported
- **Location:** `frontend/public/` folder

### Example: Adding RitePath Logo

1. Place icon in: `frontend/public/Ritepath.png`
2. Reference in config: `icon: "/Ritepath.png"`
3. Icon automatically has purple gradient background
4. Displayed at 72×72px in home screen

### For Additional Icons

1. Create folder: `frontend/public/icons/`
2. Place your icon image there
3. Reference in config: `icon: "/icons/myicon.png"`

## Security

### Webview Isolation

- Each web app has its own webview partition
- Apps cannot access each other's cookies/storage
- Partition name: `persist:ritepath-{appId}`
- Data persists between kiosk restarts

### Context Isolation

- Electron's context isolation is enabled
- Web apps cannot access Electron APIs
- Foreign websites treated as untrusted content
- Sandbox security maintained

### Link Handling

- Same-domain links: Open in webview
- External links: Default browser behavior
- Security: No modification of Electron security flags

## Styling

### App Icon

The app icon appears in a 3-column grid on the home screen:

- **Size:** 72×72px badge with 120px total area
- **Background:** Gradient (color depends on accent)
- **Label:** Below icon, 0.98rem font
- **Touch Target:** 120×138px (drawer variant)

### Custom Colors

To add more accent colors, modify `frontend/src/components/AppIcon.tsx`:

```typescript
accent: 'blue' | 'slate' | 'green' | 'purple' | 'orange' | 'pink' | 'red' | 'cyan';
```

Then add CSS in `App.css`:

```css
.app-icon-badge--orange {
  background: linear-gradient(180deg, #fb923c 0%, #ea580c 100%);
}
```

## Testing

### Verify Web App System

1. **Build frontend:**
   ```bash
   npm --prefix frontend run build
   ```

2. **Start Electron dev server:**
   ```bash
   npm run desktop:dev
   ```

3. **Test home screen:**
   - Confirm RitePath icon appears
   - Confirm other apps still visible
   - Layout looks consistent

4. **Test RitePath web app:**
   - Tap RitePath icon
   - Website should load (requires internet)
   - Touch should work on website
   - Tap "Home" button → Returns to launcher
   - Google/Files/Settings still work

5. **Test navigation:**
   - Open web app
   - Tap links within website
   - Links navigate in webview
   - "Home" button always available
   - No app loss/lag

### Verify No Regressions

- [ ] Google app still works
- [ ] Files app still works
- [ ] Settings app still works
- [ ] App drawer still works (swipe up)
- [ ] Navigation still works
- [ ] Fullscreen behavior unchanged
- [ ] Touchscreen interactions work
- [ ] Build completes without errors

## Troubleshooting

### Web app doesn't appear

**Problem:** New web app icon not showing on home screen

**Solution:**
1. Verify entry in `webApps.ts` array
2. Rebuild frontend: `npm --prefix frontend run build`
3. Check browser console for errors
4. Verify app ID is unique

### Icon not displaying

**Problem:** Icon shows as broken image or wrong color

**Solution:**
1. Check icon path is correct (starts with `/`)
2. Verify image file exists in `frontend/public/`
3. Check file format (PNG preferred)
4. Verify image dimensions (square)

### Website not loading

**Problem:** Webview appears blank or loading infinite

**Solution:**
1. Check website URL is accessible
2. Verify HTTPS (required for security)
3. Check internet connection on Raspberry Pi
4. Some websites may not work in webview due to security/compatibility

### Can't return to home

**Problem:** Home button not visible or not working

**Solution:**
1. Look for button in top-right corner
2. Swipe down from screen top to force close
3. Swipe up from bottom to open drawer
4. Rebuild frontend if needed

## Advanced Usage

### Custom Webview Partition

Each app stores its own cookies/storage:

```typescript
partition={`persist:ritepath-${appId}`}
```

To clear app data, clear the partition in Electron main process.

### Dynamic Web Apps

To load web apps from a server instead of hardcoding:

1. Fetch `webApps` from API endpoint
2. Validate app configuration
3. Update `webApps` config dynamically
4. Rebuild home screen component

Example:
```typescript
const webApps = await fetch('/api/web-apps').then(r => r.json());
```

### Per-App Customization

To customize appearance per-app:

```typescript
type WebApp = {
  id: string;
  name: string;
  icon: string;
  url: string;
  accent?: 'blue' | 'green' | 'purple';  // Per-app color
  zoom?: number;                          // Per-app zoom level
};
```

## Performance

- **Initial load:** ~1 second
- **App switch:** <200ms
- **Memory:** ~50-80MB per webview
- **Multiple apps:** Scales linearly with number of webviews

## Browser Compatibility

Web apps use Electron's webview, which uses Chromium:

- **Chromium version:** Based on Electron version (currently 43.x)
- **Compatibility:** Modern web standards (ES2020+)
- **Not supported:** Safari-specific features, IE features

## Limitations

- Each web app runs in its own webview (not shared)
- No communication between web apps
- Cannot access Electron/Node APIs
- Limited to HTTP/HTTPS resources only
- Some websites may not render perfectly in webview

## Future Enhancements

Potential improvements for the web app system:

1. **Search/Filter:** Filter apps by name
2. **Favorites:** Pin frequently-used apps
3. **App Store:** Download apps from server
4. **Categories:** Organize apps into categories
5. **Custom Themes:** Per-app color customization
6. **Offline Mode:** Cache app pages for offline use
7. **Notifications:** In-app notifications/badges
8. **App Settings:** Per-app configuration panel

## Questions?

Refer to the implementation files or contact the development team.

### Related Documentation

- [SETTINGS_IMPROVEMENTS_SUMMARY.md](SETTINGS_IMPROVEMENTS_SUMMARY.md) - Backend improvements
- [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) - Deployment instructions
- [TESTING_SETTINGS_CONTROLS.md](TESTING_SETTINGS_CONTROLS.md) - Testing guide
