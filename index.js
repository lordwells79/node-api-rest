const express = require("express");
require("dotenv").config();
const path = require("path");
const app = express();
const bodyParser = require("body-parser");
const stripe = require("stripe")(process.env.NEXT_PUBLIC_STRIPE_SECRET_KEY);
const cors = require("cors");

// Abilita le richieste CORS
app.use(cors());

app.use(express.json());
app.use(bodyParser.json());

//const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } = process.env;
// const PAYPAL_CLIENT_ID =
//   "AcSI5h8u49XhtqWW5zHgTPzoLwjQjfVYdl2MmMU3qtPB1zAtplWwxOZM5XWZvWilkUuaMCGrStpI6F6N";
// const PAYPAL_CLIENT_SECRET =
//   "EGaenJ3RWjQr2BU3wxmi8IhhJSUXBIGlrV4oUaJP_UXh5MnQnLa-KBSPLpBJYOXM4TLUImu2gZcQvfiq";
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;

const basePayPal = "https://api-m.sandbox.paypal.com";

//STRIPE  Definisci l'endpoint API per creare una sessione di pagamento
app.post("/api/checkout_sessions", async (req, res) => {
  // Ottieni i dettagli dell'ordine dalla richiesta req.body

  const orderDetails = req.body;
  console.log("order Details: ", orderDetails);

  try {
    // Crea una sessione di pagamento su Stripe
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: orderDetails.cartItems.map((item) => {
        const img = item.image[0].asset._ref;
        const newImage = img
          .replace(
            "image-",
            "https://cdn.sanity.io/images/znfmxfxf/production/"
          )
          .replace("-webp", ".webp");
        return {
          price_data: {
            currency: "eur",
            product_data: {
              name: item.name,
              images: [newImage],
            },
            unit_amount: item.price * 100,
          },
          adjustable_quantity: {
            enabled: true,
            minimum: 1,
          },
          quantity: item.quantity,
        };
      }),

      submit_type: "pay",
      mode: "payment",
      success_url: req.headers.origin + "/success", // Pagina di successo
      cancel_url: req.headers.origin + "/canceled", // Pagina di cancellazione
    });

    // Invia l'ID della sessione di pagamento come risposta
    res.json({ sessionId: session.id });
  } catch (error) {
    console.error(
      "Errore durante la creazione della sessione di pagamento:",
      error
    );
    res.status(500).json({ error: "Errore durante il pagamento" });
  }
});

// Fine STRIPE

// PAYPAL

/**
 * Generate an OAuth 2.0 access token for authenticating with PayPal REST APIs.
 * @see https://developer.paypal.com/api/rest/authentication/
 */
const generateAccessToken = async () => {
  try {
    if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
      throw new Error("MISSING_API_CREDENTIALS");
    }
    const auth = Buffer.from(
      PAYPAL_CLIENT_ID + ":" + PAYPAL_CLIENT_SECRET
    ).toString("base64");

    const response = await fetch(`${basePayPal}/v1/oauth2/token`, {
      method: "POST",
      body: "grant_type=client_credentials",
      headers: {
        Authorization: "Basic " + auth,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    const data = await response.json();

    return await data.access_token;
  } catch (error) {
    console.error("Failed to generate Access Token:", error);
  }
};

/**
 * Create an order to start the transaction.
 * @see https://developer.paypal.com/docs/api/orders/v2/#orders_create
 */
const createOrder = async (cart) => {
  // use the cart information passed from the front-end to calculate the purchase unit details
  console.log(
    "shopping cart information passed from the frontend createOrder() callback:",
    cart
  );

  const accessToken = await generateAccessToken();
  const payload = JSON.stringify({
    intent: "CAPTURE",
    purchase_units: [
      {
        amount: {
          currency_code: "EUR",
          value: cart.totalPrice,
          breakdown: {
            item_total: {
              currency_code: "EUR",
              value: cart.totalPrice,
            },
          },
        },

        items: cart.cartItems?.map((item) => {
          return {
            name: item.name,
            quantity: item.quantity,
            category: "PHYSICAL_GOODS",

            unit_amount: {
              currency_code: "EUR",
              value: item.price,
            },
          };
        }),
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED",
          brand_name: "EXAMPLE INC",
          locale: "it-IT",
          landing_page: "LOGIN",
          user_action: "PAY_NOW",
          return_url: "http://localhost:4200/success",
          cancel_url: "http://localhost:4200",
        },
      },
    },
  });

  const response = await fetch(`${basePayPal}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",

      Authorization: "Bearer " + accessToken,
    },
    body: payload,
  });

  return handleResponse(response);
};
/**
 * Capture payment for the created order to complete the transaction.
 * @see https://developer.paypal.com/docs/api/orders/v2/#orders_capture
 */
const captureOrder = async (orderID) => {
  const accessToken = await generateAccessToken();
  const url = `${basePayPal}/v2/checkout/orders/${orderID}/capture`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",

      Authorization: `Bearer ${accessToken}`,
      // Uncomment one of these to force an error for negative testing (in sandbox mode only). Documentation:
      // https://developer.paypal.com/tools/sandbox/negative-testing/request-headers/
      // "PayPal-Mock-Response": '{"mock_application_codes": "INSTRUMENT_DECLINED"}'
      // "PayPal-Mock-Response": '{"mock_application_codes": "TRANSACTION_REFUSED"}'
      // "PayPal-Mock-Response": '{"mock_application_codes": "INTERNAL_SERVER_ERROR"}'
    },
  });

  return handleResponse(response);
};

app.post("/api/orders", async (req, res) => {
  try {
    // use the cart information passed from the front-end to calculate the order amount detals
    const cart = req.body;
    //console.log("REQ.BODY ", req);

    const { jsonResponse, httpStatusCode } = await createOrder(cart);
    //const jsonResponse = await createOrder(cart);
    //console.log("Risposta 1 ", jsonResponse);

    res.status(httpStatusCode).json(jsonResponse);
  } catch (error) {
    const status = 500;
    console.error("Failed to create order:", error);
    res.status(status).json({ error: "Failed to create order." });
  }
});

app.post("/api/orders/:orderID/capture", async (req, res) => {
  try {
    console.log("REQ_PARAM", req.params.orderID);
    const orderID = await req.params.orderID;
    const { jsonResponse, httpStatusCode } = await captureOrder(orderID);
    //const jsonResponse = await captureOrder(orderID);
    console.log("Risposta 2 ", jsonResponse);

    res.status(httpStatusCode).json(jsonResponse);
  } catch (error) {
    console.error("Failed to capture order:", error);
    res.status(500).json({ error: "Failed to capture order." });
  }
});

async function handleResponse(response) {
  try {
    const jsonResponse = await response.json();
    return {
      jsonResponse,
      httpStatusCode: response.status,
    };
  } catch (err) {
    const errorMessage = await response.text();
    throw new Error(errorMessage);
  }
}
app.get("/", (req, res) => {
  res.send("Hey this is my API running 🥳");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
