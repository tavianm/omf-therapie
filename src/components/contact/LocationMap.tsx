export const LocationMap = () => {
  const zoomLevel = "7";
  return (
    <div>
      <h2 className="text-2xl font-serif font-semibold text-sage-800 mb-6">
        Cabinet
      </h2>
      <div className="aspect-w-16 aspect-h-9">
        <iframe
          src={`https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2624.9916256937595!2d2.3294481156744993!3d48.86863857928921!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f${zoomLevel}.1!3m3!1m2!1s0x12b6a5185c21ddcd%3A0x48b6a6aff99ccafc!2sOriane%20MONTABONNET%20-%20Th%C3%A9rapeute!5e1!3m2!1sen!2sfr!4v1628597681669!5m2!1sen!2sfr`}
          className="w-full h-[300px] rounded-lg"
          loading="lazy"
          title="Localisation du cabinet"
        ></iframe>
      </div>
    </div>
  );
};
