import { COMPANY_NAME, CONTACT_INFO } from "../../config/global.config";

export const LocationMap = () => {
  // Query-based embed derived from config so the map cannot drift from the
  // canonical cabinet address. The old embed hardcoded Paris coordinates in
  // its opaque `pb=` parameter while the rest of the site says Montpellier.
  const q = encodeURIComponent(`${COMPANY_NAME} ${CONTACT_INFO.address}`);
  const src = `https://www.google.com/maps?q=${q}&z=15&output=embed`;
  return (
    <div>
      <h2 className="text-2xl font-serif font-semibold text-sage-800 mb-6">
        Cabinet
      </h2>
      <div className="aspect-w-16 aspect-h-9">
        <iframe
          src={src}
          className="w-full h-[300px] rounded-lg"
          loading="lazy"
          title={`Localisation du cabinet — ${CONTACT_INFO.address}`}
        ></iframe>
      </div>
    </div>
  );
};
