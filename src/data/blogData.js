/**
 * blogData.js — Skootlink blog post content.
 * Add new posts here; Blog.jsx and BlogPost.jsx read from this file, so no
 * routing or component changes are needed to publish a new post.
 *
 * Place at: src/data/blogData.js
 */
export const BLOG_POSTS = [
  {
    slug: 'how-to-become-uber-bolt-driver-without-a-car',
    title: 'How to Become an Uber or Bolt Driver in South Africa Without Owning a Car',
    metaDescription:
      "Don't own a car? You can still drive for Uber or Bolt in South Africa. Here's how vehicle rental works, what it costs, and how to get started.",
    publishDate: '2026-06-15',
    readTime: '6 min read',
    excerpt:
      "Thousands of South Africans want to drive for Uber or Bolt but don't own a car. Here's exactly how to get on the road without buying one.",
    keywords: ['uber driver', 'bolt driver', 'rent a car for uber', 'vehicle rental south africa', 'gig economy'],
    content: [
      { type: 'p', text: "One of the biggest barriers to becoming an Uber or Bolt driver in South Africa isn't the app sign-up — it's the vehicle. A reliable car costs real money, and if you're just starting out, buying one before you've even earned a rand from driving is a big risk. The good news: you don't have to." },
      { type: 'h2', text: 'Why vehicle ownership isn\'t actually required' },
      { type: 'p', text: "Uber and Bolt both require a vehicle that meets their age, condition, and inspection requirements — but nothing in their terms says you have to own it outright. Renting a vehicle from an independent owner is a completely legitimate way to meet that requirement, and it's how a growing number of drivers in Johannesburg, Cape Town, Durban, and other major cities get started." },
      { type: 'h2', text: 'How vehicle rental for gig driving actually works' },
      { type: 'list', items: [
        'A vehicle owner lists their car (or scooter, for delivery work) on a rental marketplace like Skootlink, setting a weekly rental price and any deposit required.',
        'You browse available vehicles in your area, filtering by type, price, and location.',
        'You send a rental proposal to the owner with your intended dates and any message about how you plan to use the vehicle.',
        'Once the owner accepts, a formal rental agreement is generated covering both parties — this is the difference between a proper rental and an informal, risky handshake deal.',
        'You collect the vehicle, complete Uber/Bolt\'s own vehicle inspection if required, and you\'re on the road.',
      ] },
      { type: 'h2', text: 'What it costs' },
      { type: 'p', text: "Weekly rental prices vary by vehicle type, age, and city, but the model is designed so your rental cost is a predictable weekly expense you cover from your driving earnings — not a large upfront purchase. Most owners also require a refundable security deposit, held in case of damage." },
      { type: 'h2', text: 'What to check before you rent' },
      { type: 'list', items: [
        'Confirm the vehicle meets your specific platform\'s (Uber/Bolt) age and condition requirements before committing.',
        'Make sure there\'s a real rental agreement in place — not just a verbal arrangement — so both you and the owner are protected if something goes wrong.',
        'Check whether the deposit is refundable and under what conditions.',
        'Ask about who\'s responsible for routine maintenance and who covers running costs like fuel.',
      ] },
      { type: 'h2', text: 'Ready to get started?' },
      { type: 'p', text: 'If you\'re ready to find a vehicle, browse available cars, bikes, and scooters near you and send your first rental proposal directly through the app.' },
    ],
  },
  {
    slug: 'best-vehicles-for-food-delivery-driving-south-africa',
    title: 'Best Vehicles for Food Delivery Driving in South Africa (Uber Eats, Mr D, Bolt Food)',
    metaDescription:
      'Scooter, bike, or car? A practical guide to choosing the right vehicle for food delivery driving in South Africa, and how to rent one if you don\'t already own it.',
    publishDate: '2026-06-22',
    readTime: '5 min read',
    excerpt:
      'The right vehicle for delivery driving depends on your city, the platforms you work with, and your budget. Here\'s how to choose — and rent — the right one.',
    keywords: ['delivery driver vehicle', 'scooter rental', 'uber eats driver', 'bolt food delivery', 'mr d food driver'],
    content: [
      { type: 'p', text: 'Food delivery platforms like Uber Eats, Mr D Food, and Bolt Food all accept a mix of vehicle types, and picking the right one has a real effect on how much you earn per shift, not just what it costs to run.' },
      { type: 'h2', text: 'Scooters — the default choice for most delivery drivers' },
      { type: 'p', text: 'In dense urban areas, a scooter is usually the fastest and cheapest way to deliver. Lower fuel costs, easier parking, and the ability to filter through traffic all add up to more completed deliveries per hour compared to a car in the same conditions.' },
      { type: 'h2', text: 'Bicycles — lowest cost, best for short, dense routes' },
      { type: 'p', text: 'In city-centre areas with short delivery distances, bicycles remain a viable option for some drivers — no fuel cost at all, though your realistic delivery radius and speed are more limited.' },
      { type: 'h2', text: 'Cars — best for longer distances, bulk orders, or bad weather' },
      { type: 'p', text: 'For suburban areas with longer distances between restaurants and customers, or if you want to keep working through bad weather without exposure, a car is often the better fit — at the cost of higher fuel spend and slower manoeuvring in traffic.' },
      { type: 'h2', text: 'Don\'t own the right vehicle? You can still switch' },
      { type: 'p', text: 'One advantage of renting rather than owning: if you find scooter delivery isn\'t working for your area or schedule, you\'re not stuck. You can end a rental agreement and switch to a different vehicle type for your next one, instead of being locked into a vehicle you bought that no longer suits your work.' },
      { type: 'h2', text: 'How to rent the right vehicle for delivery work' },
      { type: 'list', items: [
        'Browse available scooters, bikes, and cars in your delivery area.',
        'Compare weekly rental prices against your expected earnings for that vehicle type in your area.',
        'Confirm the vehicle meets your delivery platform\'s specific requirements before agreeing to rent.',
        'Send a rental proposal directly to the owner — once accepted, you get a proper rental agreement covering both of you.',
      ] },
    ],
  },
];

export function getBlogPostBySlug(slug) {
  return BLOG_POSTS.find(p => p.slug === slug) || null;
}
