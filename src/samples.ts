// Fictional sample inputs for trying the app. Names, addresses and numbers are
// made up (postcode 000000, +65 6000 numbers) and do not describe real businesses.

export interface Sample {
  id: string;
  label: string;
  sensitivity: 'private' | 'public';
  text: string;
}

const draft = `Crumb & Kettle is opening soon!

We are a cosy neighbourhood bakery bringing you the best sourdough in town, baked fresh every morning with high-quality ingredients. Our menu has various breads, pastries and more, all at affordable prices.

Come and visit our conveniently located shop near the park. We also do custom celebration cakes, contact us for pricing.

Follow us for updates on our grand opening. We can't wait to meet you!`;

const clinic = `Harbourline Dental is a family dental clinic at 88 Example Road, #02-15, Singapore 000000, a 3-minute walk from Example MRT station.

We offer check-ups and cleaning (from S$85), fillings, root canal treatment, braces and clear aligners for adults and children. First-time patients can book a consultation for S$45.

Opening hours: Monday to Friday 9am to 6pm, Saturday 9am to 1pm. Closed on Sundays and public holidays.

Our three dentists have been practising for a combined 30 years. The clinic is registered with the Ministry of Health and accepts CHAS and Medisave for eligible treatments.

Book online at www.harbourline-dental.example or call +65 6000 1234. Email hello@harbourline-dental.example for insurance questions.`;

function longPage(): string {
  const intro = `Northpoint Makers Fair 2026 is a two-day market for independent designers, held on 12 and 13 December 2026 at Example Hall, 1 Example Avenue, Singapore 000000. Entry is free; workshops cost S$25 to S$60 and must be booked in advance. Doors open 10am to 8pm on both days.`;
  const zones = ['Ceramics', 'Leather goods', 'Prints and stationery', 'Jewellery', 'Textiles', 'Woodwork', 'Plants', 'Kids and family', 'Food and drink', 'Upcycled fashion', 'Illustration', 'Candles and scent'];
  const zoneText = zones
    .map(
      (z, i) => `${z} zone (Hall ${String.fromCharCode(65 + (i % 3))}): ${z} makers will show and sell small-batch work. Each stall is run by the maker, so you can ask how things are made, request custom orders and learn about materials. Card and PayNow are accepted at most stalls; a few makers are cash only and display a sign. Stall list and map are posted at the entrance and updated on the morning of each day. Please keep aisles clear and use the bag drop near the main doors for large items.`,
    )
    .join('\n\n');
  const workshops = [
    ['Wheel-throwing taster', 'S$60', '11am and 3pm'],
    ['Hand-stitched card wallet', 'S$45', '12pm and 4pm'],
    ['Risograph print basics', 'S$35', '1pm and 5pm'],
    ['Terrarium building', 'S$40', '11am and 2pm'],
    ['Kids clay animals', 'S$25', '10:30am and 1:30pm'],
    ['Natural dye scarf', 'S$55', '12pm and 3pm'],
  ]
    .map(([n, p, t]) => `${n} workshop costs ${p} per person and runs at ${t} on both days. Sessions last 60 to 90 minutes, materials are included, and places are limited to 12 people. Arrive 10 minutes early. Refunds are possible up to 48 hours before the session; after that you may transfer your place to a friend.`)
    .join('\n\n');
  const faq = `Frequently asked questions

Is the fair wheelchair accessible? Yes. Example Hall has step-free access from the taxi stand, lifts to all levels and accessible toilets on each floor.

Can I bring my dog? Small dogs on a leash are welcome in Halls A and B. Only assistance animals are allowed in the food and drink zone.

Is there parking? The hall car park has about 300 lots and fills up by noon on weekends. Public transport is recommended: Example MRT exit B is a 5-minute walk.

Can I apply to be a maker? Applications for 2026 are closed. Applications for 2027 open in March 2027.

What if it rains? The fair is fully indoors.

Lost and found: items are kept at the information counter until 8pm each day and then at the organiser's office for 14 days.`;
  const terms = `Terms of entry

By entering the venue you agree to follow the instructions of staff and security. The organiser may refuse entry to anyone behaving in a way that puts others at risk. Photography for personal use is welcome; please ask makers before photographing their work up close. Commercial filming requires written permission from the organiser.

Makers are independent sellers. Purchases are contracts between you and the maker, and refund or exchange policies are set by each maker. The organiser is not responsible for goods bought at the fair but will help you contact a maker after the event if needed.

Workshop bookings are personal and non-refundable within 48 hours of the session. Children under 12 must be accompanied by an adult in all workshops except Kids clay animals, where parents may wait in the seating area outside.

The organiser collects booking names and emails only to send booking confirmations and changes to the programme, and deletes them 30 days after the fair.`;
  const talks = [
    ['10:30am', 'Opening walk-through of the halls with the organisers'],
    ['11:30am', 'Pricing your handmade work: a panel with four makers'],
    ['12:30pm', 'Live demo: throwing a teapot on the wheel'],
    ['1:30pm', 'Natural dyes from kitchen scraps'],
    ['2:30pm', 'Selling online without losing your weekends'],
    ['3:30pm', 'Repair cafe: bring one torn garment or broken mug'],
    ['4:30pm', 'Photographing small products with a phone'],
    ['5:30pm', 'Ask a maker: open questions at the main stage'],
    ['6:30pm', 'Acoustic set by a local duo at the food court'],
  ];
  const programme =
    'Programme (both days, main stage in Hall B; talks are free, no booking needed, seats are first come first served)\n\n' +
    ['Saturday 12 December', 'Sunday 13 December']
      .map(
        (day) =>
          `${day}\n` +
          talks
            .map(([t, n]) => `${t}: ${n}. Sessions run about 40 minutes with time for questions. The talk is in English, and slides are shared at the information counter afterwards for anyone who wants a copy.`)
            .join('\n'),
      )
      .join('\n\n');
  const travel = `Getting there

By train: Example MRT, exit B, then follow the covered walkway for about 5 minutes. By bus: services 10, 20 and 30 stop outside the hall. By car: the hall car park is open from 9am; charges are set by the car park operator. Bicycle racks are next to the taxi stand. Ride-hailing pick-up is at the side entrance on Example Lane to keep the main road clear.

Sustainability

We ask makers to use paper or reusable packaging and not to give out single-use plastic bags. Water refill stations are in every hall, so please bring a bottle. Food stalls use reusable plates collected at return points, and the organiser publishes the waste sorted for recycling after each fair.`;
  return [intro, zoneText, programme, workshops, faq, travel, terms, `Contact: hello@northpoint-makers.example or +65 6000 5678. Organised by Northpoint Makers Collective since 2019.`].join('\n\n');
}

export const SAMPLES: Sample[] = [
  { id: 'draft', label: 'Private launch draft', sensitivity: 'private', text: draft },
  { id: 'clinic', label: 'Public clinic page', sensitivity: 'public', text: clinic },
  { id: 'long', label: 'Long public page', sensitivity: 'public', text: longPage() },
];
