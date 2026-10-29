import { describe, expect, it } from "vitest";
import { thumbnailUrl } from "./image-sources";

describe("image preview sizes", () => {
  it("requests a bounded Shopify CDN thumbnail and preserves the version", () => {
    const url = new URL(
      thumbnailUrl(
        "https://cdn.shopify.com/s/files/1/photo.jpg?v=42&width=1600",
      ),
    );
    expect(url.searchParams.get("width")).toBe("320");
    expect(url.searchParams.get("height")).toBe("320");
    expect(url.searchParams.get("v")).toBe("42");
  });
  it("leaves unrelated image hosts unchanged", () => {
    const url = "https://images.example.com/photo.jpg?signature=abc";
    expect(thumbnailUrl(url)).toBe(url);
  });
});
