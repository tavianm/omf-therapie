import emailjs from "@emailjs/browser";
import { useCallback, useState } from "react";
import type { FormData } from "../types/contact";

interface FormStatus {
  message: string;
  type: "success" | "error" | "";
}

const INITIAL_FORM_STATE: FormData = {
  name: "",
  email: "",
  phone: "",
  message: "",
};

export const useContactForm = () => {
  const [formData, setFormData] = useState<FormData>(INITIAL_FORM_STATE);
  const [status, setStatus] = useState<FormStatus>({ message: "", type: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const { id, value } = e.target;
      setFormData((prev) => ({
        ...prev,
        [id]: value,
      }));
    },
    []
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
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
    },
    [formData]
  );

  return {
    formData,
    status,
    isSubmitting,
    handleChange,
    handleSubmit,
  };
};

