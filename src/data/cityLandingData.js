/**
 * cityLandingData.js — one entry per city landing page.
 * CityLandingPage.jsx renders whichever city matches the :city route param,
 * so adding a new city is just adding an entry here — no new files needed.
 *
 * Place at: src/data/cityLandingData.js
 */
export const CITY_PAGES = {
  johannesburg: {
    cityName: 'Johannesburg',
    province: 'Gauteng',
    heading: 'Rent a Car for Uber or Bolt in Johannesburg',
    intro: "Want to drive for Uber or Bolt in Johannesburg but don't own a qualifying vehicle? Browse cars available to rent from independent owners across Joburg — no large upfront purchase required.",
    highlights: [
      'Vehicles located across Johannesburg, Sandton, Randburg, Soweto and surrounding areas',
      'Weekly rental pricing — no need to buy a car outright',
      'A formal rental agreement between you and the vehicle owner for every rental',
      'Vehicle types include sedans, hatchbacks, and scooters for delivery driving',
    ],
  },
  'cape-town': {
    cityName: 'Cape Town',
    province: 'Western Cape',
    heading: 'Rent a Car for Uber or Bolt in Cape Town',
    intro: "Looking to drive for Uber or Bolt in Cape Town without buying a car first? Browse vehicles available to rent from independent owners across the city and southern suburbs.",
    highlights: [
      'Vehicles located across Cape Town CBD, Southern Suburbs, and the Cape Flats',
      'Weekly rental pricing — no large upfront purchase required',
      'A formal rental agreement between you and the vehicle owner for every rental',
      'Vehicle types include sedans, hatchbacks, and scooters for delivery driving',
    ],
  },
  durban: {
    cityName: 'Durban',
    province: 'KwaZulu-Natal',
    heading: 'Rent a Car for Uber or Bolt in Durban',
    intro: "Want to start driving for Uber or Bolt in Durban but don't have your own car? Browse vehicles available to rent from independent owners across the greater Durban area.",
    highlights: [
      'Vehicles located across Durban CBD, Umhlanga, Pinetown and surrounding areas',
      'Weekly rental pricing — no large upfront purchase required',
      'A formal rental agreement between you and the vehicle owner for every rental',
      'Vehicle types include sedans, hatchbacks, and scooters for delivery driving',
    ],
  },
};

export function getCityPage(citySlug) {
  return CITY_PAGES[citySlug] || null;
}
