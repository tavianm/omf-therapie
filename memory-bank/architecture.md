# Architecture

**Last Updated:** January 14, 2025

## Project Structure

```
omf-therapie/
├── public/                    # Static assets
│   ├── assets/               # Images, icons, favicons
│   ├── reports/              # Accessibility and performance reports
│   ├── CNAME                 # Custom domain config
│   ├── robots.txt            # Search engine directives
│   └── sitemap.xml           # Generated sitemap
├── src/
│   ├── components/           # React components
│   │   ├── blog/            # Blog-specific components
│   │   ├── common/          # Shared components
│   │   ├── contact/         # Contact page components
│   │   ├── footer/          # Footer components
│   │   ├── home/            # Home page components
│   │   ├── navigation/      # Navigation components
│   │   └── pricing/         # Pricing components
│   ├── config/              # Configuration files
│   ├── hooks/               # Custom React hooks
│   ├── pages/               # Route components
│   ├── types/               # TypeScript type definitions
│   ├── utils/               # Utility functions
│   │   └── blogs/          # Blog content modules
│   ├── App.tsx              # Root component
│   ├── main.tsx             # Application entry point
│   └── index.css            # Global styles
├── scripts/                  # Build and utility scripts
└── memory-bank/             # Project knowledge repository
```

## Application Architecture

### Single Page Application (SPA)

- Client-side routing with React Router
- No server-side rendering (SSR)
- Static site generation for deployment
- Hash-free URLs with history API

### Component Hierarchy

```
App
├── Router
│   ├── Navbar (persistent)
│   ├── Main Content (route-based)
│   │   ├── Home (lazy loaded)
│   │   ├── Contact (lazy loaded)
│   │   ├── Blog (lazy loaded)
│   │   ├── BlogPost (lazy loaded)
│   │   └── Accessibilite (lazy loaded)
│   ├── Footer (persistent)
│   └── AutoScrollHandler
```

### Routing Strategy

**Section-Based Navigation:**

- Multiple URL paths map to Home page with auto-scroll to sections
- Configured via `pathToSectionMap` in App.tsx
- Examples: `/Tarifs` → scrolls to #pricing, `/Services` → scrolls to #services

**Dedicated Pages:**

- `/contact` - Contact form and information
- `/blog` - Blog post listing with pagination
- `/blog/:slug` - Individual blog post detail
- `/accessibilite` - Accessibility statement

**404 Handling:**

- All unmatched routes redirect to home

### Data Flow

**Blog System:**

1. Blog posts stored as TypeScript modules in `src/utils/blogs/`
2. Central index exports all blog metadata
3. `useBlogPosts` hook provides listing and filtering
4. `useBlogPost` hook fetches individual post by slug
5. Static content - no CMS or API calls

**Contact Form:**

1. Form state managed by `useContactForm` hook
2. EmailJS integration for sending emails
3. Toast notifications for user feedback
4. Form validation and error handling

**Configuration:**

- Global config in `src/config/global.config.ts`
- Footer links in `src/config/footer.config.ts`
- Centralized configuration approach

## Component Patterns

### Presentation Components

- Purely visual components
- Accept props for data and callbacks
- No business logic or side effects
- Examples: `PriceCard`, `BlogPostCard`, `ContactItem`

### Container Components

- Handle data fetching and state
- Contain business logic
- Pass data to presentation components
- Examples: `Blog`, `BlogPost`, `Contact`

### Layout Components

- Define page structure
- Persistent across routes
- Examples: `Navbar`, `Footer`

### Utility Components

- Provide functionality without UI
- Examples: `AutoScrollHandler`, `SEO`

## Custom Hooks

### Data Hooks

- `useBlogPosts` - Blog listing with search/pagination
- `useBlogPost` - Individual blog post retrieval

### Feature Hooks

- `useContactForm` - Contact form state and submission
- `useScrollToSection` - Smooth scroll navigation
- `useClipboard` - Copy to clipboard functionality

### UI Hooks

- `useMotionVariants` - Framer Motion animation variants

## State Management

### Local State

- Component-level with `useState`
- Simple, no external state library needed

### Derived State

- Computed values from props/state
- Pagination calculations
- Search filtering

### URL State

- Route parameters (blog slug)
- Query parameters (future: search, filters)

## Performance Optimizations

### Code Splitting

- Route-level lazy loading
- React.lazy() for page components
- Suspense boundaries with fallback UI

### Asset Optimization

- Responsive images with multiple sizes
- WebP/AVIF format support
- Lazy loading images

### Bundle Optimization

- Tree-shaking via Vite
- CSS purging via Tailwind
- Minification with Terser

## Accessibility Architecture

### Semantic HTML

- Proper heading hierarchy (h1 → h6)
- Landmark regions (nav, main, footer)
- Semantic elements (article, section, aside)

### ARIA Support

- ARIA labels where needed
- Role attributes for interactive elements
- Live regions for dynamic content

### Keyboard Navigation

- Tab order management
- Focus indicators
- Skip links (main content)

### Testing Strategy

- Automated pa11y audits
- Lighthouse accessibility scoring
- Manual keyboard/screen reader testing

## Build & Deployment Architecture

### Build Process

1. TypeScript compilation
2. React component bundling
3. CSS processing (Tailwind → PostCSS)
4. Asset optimization
5. Code splitting
6. Minification

### Deployment Pipeline

- Git push to main branch
- Netlify automatic build trigger
- Build command: `npm run build`
- Deploy from `dist/` directory
- Custom domain DNS configuration

### Environment Management

- `.env` for sensitive configuration
- EmailJS credentials
- No backend/database needed

## Monitoring & Auditing

### Accessibility

- pa11y automated testing
- Lighthouse CI integration
- HTML reports in `public/reports/`

### Performance

- Lighthouse performance audits
- Core Web Vitals monitoring
- Bundle size tracking

## Security Considerations

### Client-Side Security

- No sensitive data stored client-side
- EmailJS handles form submissions securely
- HTTPS enforced via Netlify

### Content Security

- Static site with no server vulnerabilities
- No user authentication/authorization needed
- Public content only

## Future Scalability

### Current Limitations

- Static blog posts (no CMS)
- No user accounts or personalization
- Limited to French language
- No analytics dashboard

### Potential Enhancements

- Headless CMS integration (e.g., Strapi, Contentful)
- Multi-language support (i18n)
- Advanced analytics integration
- Newsletter subscription system
- Online appointment booking
- Client portal for existing patients
