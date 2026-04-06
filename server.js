const express = require('express');
const twilio = require('twilio');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ── CONFIG ──────────────────────────────────────────────
const TWILIO_ACCOUNT_SID = 'AC1b264e238d5bc08b48ac5e345a3a7357';
const TWILIO_AUTH_TOKEN  = 'f2025dc9a0cc85c47be57cc8eb6031ef';
const TWILIO_NUMBER      = '+17405575029';
const OWNER_NUMBER       = '+27713627284';
const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY; // set this in your environment

const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
const anthropic    = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// ── IN-MEMORY SESSION STORE ─────────────────────────────
// Stores conversation state per caller
const sessions = {};

// ── MENU KNOWLEDGE ──────────────────────────────────────
const MENU = `
DUCK N DIVE RESTAURANT MENU

BAR SNACKS:
- Meat Basket: Cheesy sausages, 300g steak strips, meat balls, chicken strips with chips - R380
- Duckies Basket: 4 Samoosas, 4 spring rolls, 6 cheesy sausages, 4 cheesy Jalapeno sambals with chips - R280
- Seafood Basket: A range of seafood treats with chips and tartar sauce - R210
- Cheese Board: Selection of cheeses, biltong, biscuits, fresh fruit and figs in syrup - R140

SALADS:
- Duck N Dive Greek Salad: Lettuce, tomato, cucumber, onions, green pepper, olives, feta and croutons with DND dressing - R115
- Cajun Chicken Salad: Grilled chicken breasts in strips, lettuce, cherry tomatoes, onions and mango with honey and mustard dressing - R135
- Dont Mess Around: Chicken, bacon, mushrooms, lettuce, cherry tomatoes, onions, olives, croutons and feta - R155

STARTERS:
- Squid Tentacles: Dusted with flour, deep fried with sweet chilli dipping sauce - R115
- Crumbed Mushrooms: Fresh button mushrooms, crumbed and deep fried with dipping sauce - R95
- Snails: 6 succulent snails in creamy cheesy garlic sauce - R105
- Jalapeno Poppers: 4 jalapenos with bacon and cream cheese filling, with dipping sauce - R105
- Shrimp Cocktail: Generous portion of shrimps with avo and special pink sauce - R95
- Oysters: 6 oysters on ice with lemon and tabasco, can be ordered individually - Market price (SQ)
- Springbok Carpaccio: Thinly sliced raw Springbok fillet with tangy mouthwatering dressing - R115
- Mussel Pot: Mussels in creamy white wine and garlic sauce with fresh bread - R105

TRY SOMETHING LIGHT:
- Chicken Livers: Tender chicken livers in creamy tomato Peri-Peri sauce with bread - R90
- Duck N Dive Prego Roll: 150g fillet steak basted with prego sauce, grilled, with chips or salad - R135
- Beef Livers and Onion: 200g tender beef livers with pap or mashed potatoes - R115
- Bangers and Mash: English classic, 2x200g pork sausages, peas, mash and gravy - R135
- Wors, Pap and Sheba: Traditional South African favourite - R125
- Russian and Chips: Good old fashioned footlong Russian with chips - R95

GETTING TO THE GOOD STUFF (Mains):
- Pub Style Fish and Chips: English pub favourite with chips, peas and tartar sauce - R105
- Homemade Cottage Pie: Lean mince meat topped with mash potato, served with salad - R125
- Beef or Chicken Curry: Durban style curry in a potjie pot, yellow rice and sambals OR bunny chow - R115
- Beef Lasagne: Yummy homemade beef lasagne with salad - R130
- Beef or Chicken Schnitzel: Tender chicken breast or steak, smothered in bread crumbs, fried, with chips and salad or veg - R125
- Tagliatelle Alfredo: Vegetarian option available - R105

OUT OF THE FLAMES (Grills - served with choice of 2 sides: chips, baked potato, salad or veg):
- Fillet Steak: 250g fillet, char-grilled to your liking - R225
- Pesto Fillet: 250g fillet char-grilled topped with basil pesto and mozzarella - R245
- Duck's Famous T-Bone Steak: 500g matured T-Bone, char-grilled to your liking - R200
- Rump Steak: 300g matured rump, char-grilled to your liking - R175
- Mexican Rump Steak: 300g matured rump with avo, salsa, bacon and mozzarella - R195
- Rump Espetada: 300g rump on a skewer, char-grilled - R185
- The Best Ribs in Town: 400-500g rack of ribs, basted in secret BBQ sauce, flamed grilled with chips - R210
- Prawns: 10 or 20 succulent prawns, Peri-Peri or garlic lemon butter sauce - Market price (SQ)
- Cordon Bleu: Beef crumbed filled with ham and mozzarella, OR Chicken filled with basil pesto and mozzarella wrapped in bacon - R165
- Pork Loin Chops: 400g pork loin chops cooked to perfection - R165
- Lamb Loin Chops: 400g lamb loin chops cooked to perfection - R220
- Portuguese Chicken: Half chicken flamed grilled, choice of Peri-Peri or Lemon and Herb basting - R165

ON THE RUN (Available 10AM-2PM, takeaway only, no sit downs):
- Footlong Hot Dog with Caramelized Onions - R45
- Chicken Prego - R45
- Sweet Chilli Chicken Wrap - R45
- Boerie Roll - R45
`;

const SYSTEM_PROMPT = `You are the friendly voice assistant for Duck N Dive, a popular pub and restaurant in South Africa. 
You answer incoming calls and help customers with:
1. Menu questions - what dishes are available, ingredients, prices
2. Taking table reservations - collect name, phone number, date, time, and party size
3. General info about the restaurant

IMPORTANT RULES:
- Keep responses SHORT and conversational - this is a phone call, not an essay
- Speak naturally, like a friendly person, not a robot
- When collecting reservation details, get one piece of info at a time
- Always confirm reservation details back to the caller before finalising
- When a reservation is complete, say "RESERVATION_COMPLETE: [name]|[phone]|[date]|[time]|[party size]" at the END of your message (this triggers the SMS system)
- Prices are in South African Rand (R)
- If someone asks about something not on the menu, politely say you don't have that

Here is the full menu for reference:
${MENU}`;

// ── ROUTES ──────────────────────────────────────────────

// Entry point - incoming call
app.post('/voice', (req, res) => {
  const callSid = req.body.CallSid;
  const callerNumber = req.body.From;

  // Init session
  sessions[callSid] = {
    callerNumber,
    history: []
  };

  const twiml = new twilio.twiml.VoiceResponse();
  const gather = twiml.gather({
    input: 'speech',
    action: '/conversation',
    method: 'POST',
    speechTimeout: 'auto',
    language: 'en-ZA'
  });

  gather.say(
    { voice: 'Polly.Ayanda-Neural' },
    'Welcome to Duck N Dive! I can help you with our menu, prices, or make a reservation. How can I help you today?'
  );

  res.type('text/xml');
  res.send(twiml.toString());
});

// Ongoing conversation
app.post('/conversation', async (req, res) => {
  const callSid = req.body.CallSid;
  const speechResult = req.body.SpeechResult || '';

  const session = sessions[callSid] || { callerNumber: req.body.From, history: [] };
  sessions[callSid] = session;

  // Add user message to history
  session.history.push({ role: 'user', content: speechResult });

  try {
    // Call Claude
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: session.history
    });

    const assistantText = response.content[0].text;

    // Add assistant response to history
    session.history.push({ role: 'assistant', content: assistantText });

    // Check if reservation is complete
    if (assistantText.includes('RESERVATION_COMPLETE:')) {
      const match = assistantText.match(/RESERVATION_COMPLETE:\s*(.+)/);
      if (match) {
        const parts = match[1].split('|').map(s => s.trim());
        const [name, phone, date, time, partySize] = parts;
        await sendReservationSMS(name, phone || session.callerNumber, date, time, partySize, session.callerNumber);
      }
    }

    // Clean the text for speech (remove the RESERVATION_COMPLETE tag)
    const speechText = assistantText
      .replace(/RESERVATION_COMPLETE:[^\n]*/g, '')
      .trim();

    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({
      input: 'speech',
      action: '/conversation',
      method: 'POST',
      speechTimeout: 'auto',
      language: 'en-ZA'
    });

    gather.say({ voice: 'Polly.Ayanda-Neural' }, speechText);

    // If caller doesn't respond, hang up politely
    twiml.say({ voice: 'Polly.Ayanda-Neural' }, 'Thank you for calling Duck N Dive. Have a great day!');
    twiml.hangup();

    res.type('text/xml');
    res.send(twiml.toString());

  } catch (err) {
    console.error('Claude API error:', err);
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say({ voice: 'Polly.Ayanda-Neural' }, 'Sorry, I am having a small issue. Please hold on or call us directly on 013 790 1258.');
    twiml.hangup();
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

// ── SMS HELPER ──────────────────────────────────────────
async function sendReservationSMS(name, phone, date, time, partySize, callerNumber) {
  const customerMsg = `Hi ${name}! Your reservation at Duck N Dive is confirmed for ${date} at ${time} for ${partySize} people. See you soon! 🦆`;
  const ownerMsg    = `NEW RESERVATION 🦆\nName: ${name}\nPhone: ${phone}\nDate: ${date}\nTime: ${time}\nParty size: ${partySize}`;

  try {
    // SMS to customer
    await twilioClient.messages.create({
      body: customerMsg,
      from: TWILIO_NUMBER,
      to: callerNumber
    });

    // SMS to owner
    await twilioClient.messages.create({
      body: ownerMsg,
      from: TWILIO_NUMBER,
      to: OWNER_NUMBER
    });

    console.log('Reservation SMSes sent successfully');
  } catch (err) {
    console.error('SMS error:', err);
  }
}

// ── START ────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Duck N Dive voice bot running on port ${PORT}`));
