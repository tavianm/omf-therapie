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
        const response = await fetch("/api/contact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formData.name,
            email: formData.email,
            phone: formData.phone || undefined,
            message: formData.message,
          }),
        });

        const result = await response.json() as { success: boolean; error?: string };

        if (response.ok && result.success) {
          setStatus({
            message: "Votre message a été envoyé avec succès !",
            type: "success",
          });
          setFormData(INITIAL_FORM_STATE);
        } else {
          setStatus({
            message:
              result.error ??
              "Une erreur est survenue lors de l'envoi du message. Veuillez réessayer.",
            type: "error",
          });
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

