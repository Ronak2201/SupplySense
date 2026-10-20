# SupplySense — 3-Minute Hackathon Demonstration Script

## Minute 0:00 – 0:45 | The Problem & Core Differentiator
1. Open **SupplySense** in the **New Research (AI Workspace)** view.
2. Highlight the tagline: *"Find anything. Verify everything. Buy with confidence."*
3. Explain the core problem: Traditional search engines and LLM chatbots confuse a search snippet or advertisement with proof that a product is in stock, compliant, and within budget.
4. Click the preset prompt:
   > *"Find five 12V DC motors with a metal gearbox, rated torque above 5 kg-cm, available in India, under ₹500 each, delivered to my pincode 124001 within seven days."*
5. Point out how SupplySense extracts typed **Hard Constraints** (`Voltage = 12V`, `Gearbox = metal`, `Torque > 5 kg-cm`, `Unit Price <= ₹500`, `Delivery <= 7 days`) and separates them from **Assumptions** and **Soft Preferences**.

## Minute 0:45 – 1:45 | Live TinyFish Research & Deterministic Verification
1. Show the **TinyFish Live API Mode** toggle (pre-configured with `X-API-Key` against `https://api.search.tinyfish.ai` and `https://api.fetch.tinyfish.ai`) alongside **Deterministic Verification Sandbox Mode**.
2. Click **Run Procurement & Verification Pipeline** and watch the 8-stage progress tracker execute.
3. Inspect the results:
   - **Rank #1 (`VERIFIED_MATCH`)**: *Orange 12V 300RPM Johnson Geared DC Motor (Robu.in)* — ₹445/unit, ₹2,225 total confirmed (incl. 18% GST & free shipping), 48 units confirmed in stock, 6.2 kg-cm torque, full metal spur gearbox.
   - **Rank #2 (`UNVERIFIED` — Requires Confirmation)**: *Quartz 12V Center-Shaft DC Motor* — ₹450/unit (₹2,310 with ₹60 shipping), meets voltage and torque, but internal gearbox material is not stated on the page. SupplySense refuses to guess and flags `gearbox_material` as `UNVERIFIED`.
   - **Disqualified / Rejected (`VERIFIED_MISMATCH`)**:
     - *Robocraze 12V EcoGear Motor* — Even though it is cheaper (₹420/unit), it is **explicitly rejected** because its specification table lists a *Plastic (POM Nylon)* gearbox.
     - *ProDrive 12V Planetary Motor* — Explicitly rejected because its ₹595 unit price exceeds the ₹500 mandatory cap.
4. Click **Inspect Field Evidence** on any candidate to show verbatim quotes, CSS/table locators, and retrieval timestamps.

## Minute 1:45 – 2:30 | Multi-File BOM Intelligence & Cross-File Contradiction Detection
1. Navigate to **Files & Knowledge** in the sidebar.
2. Show the 3 loaded engineering documents (`bom_robotics_lab.csv`, `vendor_quote_alpha.txt`, and `engineering_spec_v2.txt`).
3. Highlight the **Cross-File Contradiction & Hidden Cost Detector**:
   - Flags that `vendor_quote_alpha.txt` (Page 1, Line 8) quotes a **Plastic Composite Gearbox** for `MOT-12V-300M`, directly contradicting `engineering_spec_v2.txt` (Page 1, Line 6: **All-Metal Hardened Steel Spur**).
   - Flags hidden costs in the supplier quote: **₹250 extra shipping** and **18% GST excluded from unit price**.
4. Click **Run Security Guardrail Simulation** to demonstrate real-time blocking of a Zip-Slip archive (`../../etc/passwd`), a 90MB decompression bomb, and an embedded prompt-injection attempt.

## Minute 2:30 – 3:00 | Watchlist, Persistent Memory & Validated Exports
1. Open **Watchlist & Price History** to show real timestamped price snapshots and trigger a re-verification check on the unverified Quartz motor.
2. Open **Memory Manager** to show inspectable, toggleable User Preferences (`preferred_currency = INR`, `delivery_pincode = 124001`) and Project Facts.
3. Open **Reports & Exports** and click **Download CSV Report** or **Download Executive Markdown Report**, showing the SHA-256 integrity checksum and zero-secret-leakage verification badge.
