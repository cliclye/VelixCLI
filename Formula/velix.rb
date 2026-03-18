class Velix < Formula
  desc "Multi-provider AI coding assistant with swarm orchestration"
  homepage "https://github.com/vexilo/velix-cli"
  url "https://registry.npmjs.org/velix-cli/-/velix-cli-0.1.0.tgz"
  sha256 ""  # Fill in after publishing to npm
  license "MIT"

  depends_on "node@18"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match "velix-cli", shell_output("#{bin}/velix --version")
  end
end
