# \MarketplaceAPI

All URIs are relative to *https://app.agentanchorai.com/api/v1*

Method | HTTP request | Description
------------- | ------------- | -------------
[**AcquireAgent**](MarketplaceAPI.md#AcquireAgent) | **Post** /marketplace/acquisitions | Acquire agent
[**CreateMarketplaceListing**](MarketplaceAPI.md#CreateMarketplaceListing) | **Post** /marketplace/listings | Create listing
[**ListAcquisitions**](MarketplaceAPI.md#ListAcquisitions) | **Get** /marketplace/acquisitions | List acquisitions
[**ListMarketplaceListings**](MarketplaceAPI.md#ListMarketplaceListings) | **Get** /marketplace/listings | Browse listings



## AcquireAgent

> AcquireAgent201Response AcquireAgent(ctx).AcquireAgentRequest(acquireAgentRequest).Execute()

Acquire agent



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/agentanchor/agentanchor-go"
)

func main() {
	acquireAgentRequest := *openapiclient.NewAcquireAgentRequest("ListingId_example") // AcquireAgentRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.MarketplaceAPI.AcquireAgent(context.Background()).AcquireAgentRequest(acquireAgentRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `MarketplaceAPI.AcquireAgent``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `AcquireAgent`: AcquireAgent201Response
	fmt.Fprintf(os.Stdout, "Response from `MarketplaceAPI.AcquireAgent`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiAcquireAgentRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **acquireAgentRequest** | [**AcquireAgentRequest**](AcquireAgentRequest.md) |  | 

### Return type

[**AcquireAgent201Response**](AcquireAgent201Response.md)

### Authorization

[BearerAuth](../README.md#BearerAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## CreateMarketplaceListing

> CreateMarketplaceListing201Response CreateMarketplaceListing(ctx).CreateMarketplaceListingRequest(createMarketplaceListingRequest).Execute()

Create listing



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/agentanchor/agentanchor-go"
)

func main() {
	createMarketplaceListingRequest := *openapiclient.NewCreateMarketplaceListingRequest("AgentId_example", "Title_example", "PriceType_example") // CreateMarketplaceListingRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.MarketplaceAPI.CreateMarketplaceListing(context.Background()).CreateMarketplaceListingRequest(createMarketplaceListingRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `MarketplaceAPI.CreateMarketplaceListing``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `CreateMarketplaceListing`: CreateMarketplaceListing201Response
	fmt.Fprintf(os.Stdout, "Response from `MarketplaceAPI.CreateMarketplaceListing`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiCreateMarketplaceListingRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **createMarketplaceListingRequest** | [**CreateMarketplaceListingRequest**](CreateMarketplaceListingRequest.md) |  | 

### Return type

[**CreateMarketplaceListing201Response**](CreateMarketplaceListing201Response.md)

### Authorization

[BearerAuth](../README.md#BearerAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ListAcquisitions

> ListAcquisitions200Response ListAcquisitions(ctx).Status(status).Execute()

List acquisitions



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/agentanchor/agentanchor-go"
)

func main() {
	status := "status_example" // string |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.MarketplaceAPI.ListAcquisitions(context.Background()).Status(status).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `MarketplaceAPI.ListAcquisitions``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ListAcquisitions`: ListAcquisitions200Response
	fmt.Fprintf(os.Stdout, "Response from `MarketplaceAPI.ListAcquisitions`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiListAcquisitionsRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **status** | **string** |  | 

### Return type

[**ListAcquisitions200Response**](ListAcquisitions200Response.md)

### Authorization

[BearerAuth](../README.md#BearerAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ListMarketplaceListings

> ListMarketplaceListings200Response ListMarketplaceListings(ctx).Q(q).Category(category).MinTrust(minTrust).PriceType(priceType).Sort(sort).Page(page).Limit(limit).Execute()

Browse listings



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/agentanchor/agentanchor-go"
)

func main() {
	q := "q_example" // string | Search query (optional)
	category := "category_example" // string |  (optional)
	minTrust := int32(56) // int32 |  (optional)
	priceType := "priceType_example" // string |  (optional)
	sort := "sort_example" // string |  (optional)
	page := int32(56) // int32 |  (optional) (default to 1)
	limit := int32(56) // int32 |  (optional) (default to 20)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.MarketplaceAPI.ListMarketplaceListings(context.Background()).Q(q).Category(category).MinTrust(minTrust).PriceType(priceType).Sort(sort).Page(page).Limit(limit).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `MarketplaceAPI.ListMarketplaceListings``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ListMarketplaceListings`: ListMarketplaceListings200Response
	fmt.Fprintf(os.Stdout, "Response from `MarketplaceAPI.ListMarketplaceListings`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiListMarketplaceListingsRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **q** | **string** | Search query | 
 **category** | **string** |  | 
 **minTrust** | **int32** |  | 
 **priceType** | **string** |  | 
 **sort** | **string** |  | 
 **page** | **int32** |  | [default to 1]
 **limit** | **int32** |  | [default to 20]

### Return type

[**ListMarketplaceListings200Response**](ListMarketplaceListings200Response.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)

