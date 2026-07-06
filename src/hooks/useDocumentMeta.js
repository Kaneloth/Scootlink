/**
 * useDocumentMeta.js
 * Sets document.title and the meta description tag for the current page.
 *
 * IMPORTANT LIMITATION: this only updates the DOM after React mounts, so it
 * helps Google (which executes JavaScript when crawling) but does NOT help
 * WhatsApp/Facebook/Twitter link-preview crawlers, which read only the raw
 * HTML returned by the server and never run JS. Those previews will always
 * show whatever is in index.html's <head> until pages are prerendered or
 * server-rendered. Treat this as "good enough for Google," not a full fix.
 *
 * Usage:
 *   useDocumentMeta({
 *     title: 'Page Title — Skootlink',
 *     description: 'A description under ~160 characters.',
 *   });
 *
 * Place at: src/hooks/useDocumentMeta.js
 */
import { useEffect } from 'react';

export function useDocumentMeta({ title, description }) {
  useEffect(() => {
    const previousTitle = document.title;
    if (title) document.title = title;

    let descTag = document.querySelector('meta[name="description"]');
    const previousDescription = descTag?.getAttribute('content') || '';
    if (description) {
      if (!descTag) {
        descTag = document.createElement('meta');
        descTag.setAttribute('name', 'description');
        document.head.appendChild(descTag);
      }
      descTag.setAttribute('content', description);
    }

    // Restore the site-wide defaults when this page unmounts, so navigating
    // away (e.g. back to the app) doesn't leave a stale blog-post title behind.
    return () => {
      document.title = previousTitle;
      if (descTag) descTag.setAttribute('content', previousDescription);
    };
  }, [title, description]);
}
