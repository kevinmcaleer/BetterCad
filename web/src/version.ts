/** The release this build is (the tag the image was built from), for reports and the About dialog. */
export const APP_VERSION: string = import.meta.env.VITE_VERSION || (import.meta.env.DEV ? "development" : "unreleased");
