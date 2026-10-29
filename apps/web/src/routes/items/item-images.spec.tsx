import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { ItemImages } from "./item-images";
import { ImageUrlsEditor } from "./image-urls-editor";

describe("item images", () => {
  it("mounts only six thumbnails and loads another page on demand", () => {
    const urls = Array.from(
      { length: 20 },
      (_, index) => `https://example.com/${index}.jpg`,
    );
    const { container } = render(<ItemImages images={urls} name="Test" />);
    expect(container.querySelectorAll("img")).toHaveLength(6);
    expect(
      container.querySelector('img[src="https://example.com/6.jpg"]'),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(container.querySelectorAll("img")).toHaveLength(6);
    expect(
      container.querySelector('img[src="https://example.com/0.jpg"]'),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View image 7" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a fallback for unavailable external images", () => {
    const { container } = render(
      <ItemImages images={["https://example.com/broken.jpg"]} name="Test" />,
    );
    fireEvent.error(container.querySelector("img")!);
    expect(
      screen.getByRole("img", { name: "Image unavailable" }),
    ).toBeInTheDocument();
  });

  it("does not load editor previews automatically and can change the cover", () => {
    function Editor() {
      const [value, setValue] = useState([
        "https://example.com/first.jpg",
        "https://example.com/second.jpg",
      ]);
      return <ImageUrlsEditor id="images" value={value} onChange={setValue} />;
    }
    const { container } = render(<Editor />);
    expect(container.querySelector("img")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Set as cover" }));
    expect(screen.getByRole("textbox", { name: "Image URLs 1" })).toHaveValue(
      "https://example.com/second.jpg",
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Preview" })[0]);
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://example.com/second.jpg",
    );
  });
});

describe("local image uploads", () => {
  it("uploads sequentially, keeps successful files on a partial failure and releases the busy state", async () => {
    const { vi } = await import("vitest");
    const url = `/api/v1/item-images/${"a".repeat(64)}/display.webp`;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ url }) })
      .mockResolvedValueOnce({ ok: false, status: 400 });
    vi.stubGlobal("fetch", fetchMock);
    const onChange = vi.fn();
    const onBusyChange = vi.fn();
    try {
      render(
        <ImageUrlsEditor
          id="upload"
          value={[]}
          onChange={onChange}
          onBusyChange={onBusyChange}
        />,
      );
      fireEvent.change(screen.getByLabelText("Upload images"), {
        target: {
          files: [
            new File(["image1"], "one.png", { type: "image/png" }),
            new File(["image2"], "two.png", { type: "image/png" }),
          ],
        },
      });
      const { waitFor } = await import("@testing-library/react");
      await waitFor(() => expect(onChange).toHaveBeenCalledWith([url]));
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/item-images");
      expect(fetchMock.mock.calls[0][1].body).toBeInstanceOf(FormData);
      expect(screen.getByRole("alert")).toHaveTextContent("two.png");
      expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses thumbnails until a stored image is opened", () => {
    const url = `/api/v1/item-images/${"b".repeat(64)}/display.webp`;
    const { container } = render(
      <ItemImages images={[url]} name="Local product" />,
    );
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      url.replace("display.webp", "thumbnail.webp"),
    );
    fireEvent.click(screen.getByRole("button", { name: "View image 1" }));
    expect(screen.getByRole("dialog").querySelector("img")).toHaveAttribute(
      "src",
      url,
    );
  });
});
