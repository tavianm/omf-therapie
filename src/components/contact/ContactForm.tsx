import { memo } from "react";
import { useContactForm } from "../../hooks/useContactForm";

export const ContactForm = () => {
  const { formData, status, isSubmitting, handleChange, handleSubmit } =
    useContactForm();

  return (
    <form onSubmit={handleSubmit} className="bg-white p-8 rounded-lg shadow-sm">
      <h2 className="text-2xl font-serif font-semibold text-sage-800 mb-6">
        Formulaire de Contact
      </h2>
      {status.message && (
        <div
          className={`mb-6 p-4 rounded-lg ${
            status.type === "success"
              ? "bg-green-50 text-green-800"
              : "bg-red-50 text-red-800"
          }`}
          role="alert"
          aria-live="polite"
        >
          {status.message}
        </div>
      )}
      <div className="space-y-6">
        <FormField
          id="name"
          label="Nom complet"
          type="text"
          value={formData.name}
          onChange={handleChange}
          required
        />
        <FormField
          id="email"
          label="Email"
          type="email"
          value={formData.email}
          onChange={handleChange}
          required
        />
        <FormField
          id="phone"
          label="Téléphone"
          type="tel"
          value={formData.phone}
          onChange={handleChange}
        />
        <div>
          <label
            htmlFor="message"
            className="block text-sm font-medium text-sage-700 mb-2"
          >
            Message
          </label>
          <textarea
            id="message"
            value={formData.message}
            onChange={handleChange}
            required
            rows={4}
            className="w-full px-4 py-2 rounded-lg border border-sage-200 focus:ring-2 focus:ring-mint-500 focus:border-transparent"
            aria-required="true"
          ></textarea>
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className={`w-full btn-primary justify-center ${
            isSubmitting ? "opacity-75 cursor-not-allowed" : ""
          }`}
          aria-disabled={isSubmitting}
        >
          {isSubmitting ? "Envoi en cours..." : "Envoyer"}
        </button>
      </div>
    </form>
  );
};

interface FormFieldProps {
  id: string;
  label: string;
  type: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  required?: boolean;
}

const FormField = memo(
  ({ id, label, type, value, onChange, required }: FormFieldProps) => (
    <div>
      <label
        htmlFor={id}
        className="block text-sm font-medium text-sage-700 mb-2"
      >
        {label}
      </label>
      <input
        type={type}
        id={id}
        value={value}
        onChange={onChange}
        required={required}
        className="w-full px-4 py-2 rounded-lg border border-sage-200 focus:ring-2 focus:ring-mint-500 focus:border-transparent"
        aria-required={required}
      />
    </div>
  )
);

FormField.displayName = "FormField";
