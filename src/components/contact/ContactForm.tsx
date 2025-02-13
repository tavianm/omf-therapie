import emailjs from "@emailjs/browser";
import { useState } from "react";
import type { FormData } from "../../types/contact";

const INITIAL_FORM_STATE = {
  name: "",
  email: "",
  phone: "",
  message: "",
};

export const ContactForm = () => {
  const [formData, setFormData] = useState<FormData>(INITIAL_FORM_STATE);
  const [status, setStatus] = useState({ message: "", type: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setFormData({
      ...formData,
      [e.target.id]: e.target.value,
    });
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    setStatus({ message: "", type: "" });

    try {
      const result = await emailjs.send(
        "service_bdzolup",
        "template_ora67us",
        {
          from_name: formData.name,
          from_email: formData.email,
          phone: formData.phone,
          message: formData.message,
          to_name: "Oriane Montabonnet",
        },
        "a16S46gFg6v_HVO3I"
      );

      if (result.status === 200) {
        setStatus({
          message: "Votre message a été envoyé avec succès !",
          type: "success",
        });
        setFormData(INITIAL_FORM_STATE);
      }
    } catch {
      setStatus({
        message:
          "Une erreur est survenue lors de l'envoi du message. Veuillez réessayer.",
        type: "error",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white p-8 rounded-lg shadow-sm">
      <h3 className="text-2xl font-serif font-semibold text-sage-800 mb-6">
        Formulaire de Contact
      </h3>
      {status.message && (
        <div
          className={`mb-6 p-4 rounded-lg ${
            status.type === "success"
              ? "bg-green-50 text-green-800"
              : "bg-red-50 text-red-800"
          }`}
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
          ></textarea>
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className={`w-full btn-primary justify-center ${
            isSubmitting ? "opacity-75 cursor-not-allowed" : ""
          }`}
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

const FormField = ({
  id,
  label,
  type,
  value,
  onChange,
  required,
}: FormFieldProps) => (
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
    />
  </div>
);
